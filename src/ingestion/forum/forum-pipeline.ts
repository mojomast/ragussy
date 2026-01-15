/**
 * Forum Ingestion Pipeline
 * 
 * Reuses the existing producer-consumer architecture for forum posts.
 * Each post is treated as the primary ingestion unit.
 * 
 * Architecture:
 * - Producer: reads threads, chunks posts, pushes to bounded queue
 * - Embedding Workers: fixed-size pool, one chunk per API call
 * - Upsert Workers: fixed-size pool for vector DB operations
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { logger } from '../../config/index.js';
import {
  readAllForumThreads,
  readForumThreadsFromDirectory,
  extractAllPosts,
  filterSubstantivePosts,
  filterChangedPosts,
} from './forum-reader.js';
import { chunkForumPost, chunkQuotedContent } from './forum-chunker.js';
import { embedSingleChunk } from '../embedder.js';
import {
  loadProgress,
  saveProgressBatched,
  createProgress,
  initFileProgress,
  markChunkProcessedBatched,
  markChunkFailedBatched,
  clearProgress,
  generateSessionId,
  flushProgress,
  type IngestionProgress,
} from '../progress-tracker.js';
import {
  initStateStore,
  getFileState,
  updateFileStateBatched,
  clearAllState,
  closeStateStore,
  flushStateStore,
} from '../state-store.js';
import {
  ensureCollection,
  upsertVectors,
  deleteVectorsByFilter,
  getCollectionInfo,
  getQdrantClient,
} from '../../services/qdrant.js';
import type {
  ForumThread,
  ForumPost,
  ForumChunk,
  ForumIngestionConfig,
  ForumIngestionReport,
  EmbeddedForumChunk,
} from './types.js';
import { DEFAULT_FORUM_CONFIG } from './types.js';

// ============================================================================
// DIAGNOSTICS
// ============================================================================

interface ForumPipelineDiagnostics {
  embeddingInFlight: number;
  upsertInFlight: number;
  embeddingLatencies: number[];
  rateLimitHits: number;
  retryCount: number;
  peakEmbeddingInFlight: number;
  peakUpsertInFlight: number;
  startTime: number;
}

function createDiagnostics(): ForumPipelineDiagnostics {
  return {
    embeddingInFlight: 0,
    upsertInFlight: 0,
    embeddingLatencies: [],
    rateLimitHits: 0,
    retryCount: 0,
    peakEmbeddingInFlight: 0,
    peakUpsertInFlight: 0,
    startTime: Date.now(),
  };
}

// ============================================================================
// WORKER POOL (Reused from main pipeline)
// ============================================================================

class WorkerPool<T> {
  private queue: T[] = [];
  private activeWorkers = 0;
  private readonly maxWorkers: number;
  private readonly processor: (item: T) => Promise<void>;
  private readonly name: string;
  private resolveIdle: (() => void) | null = null;
  private closed = false;

  constructor(
    maxWorkers: number,
    processor: (item: T) => Promise<void>,
    name: string
  ) {
    this.maxWorkers = maxWorkers;
    this.processor = processor;
    this.name = name;
  }

  push(item: T): void {
    if (this.closed) throw new Error(`${this.name} pool is closed`);
    this.queue.push(item);
    this.spawnWorkerIfNeeded();
  }

  private spawnWorkerIfNeeded(): void {
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      this.activeWorkers++;
      this.runWorker();
    }
  }

  private async runWorker(): Promise<void> {
    while (this.queue.length > 0 && !this.closed) {
      const item = this.queue.shift();
      if (!item) break;

      try {
        await this.processor(item);
      } catch (error) {
        logger.error({ error, pool: this.name }, 'Worker processor error');
      }
    }

    this.activeWorkers--;
    
    if (this.activeWorkers === 0 && this.queue.length === 0 && this.resolveIdle) {
      this.resolveIdle();
      this.resolveIdle = null;
    }
  }

  async drain(): Promise<void> {
    if (this.activeWorkers === 0 && this.queue.length === 0) {
      return;
    }
    return new Promise(resolve => {
      this.resolveIdle = resolve;
      this.spawnWorkerIfNeeded();
    });
  }

  close(): void {
    this.closed = true;
  }

  get inFlight(): number {
    return this.activeWorkers;
  }
}

// ============================================================================
// JOB TYPES
// ============================================================================

interface ForumChunkJob {
  chunk: ForumChunk;
  postId: string;
  threadId: string;
}

interface ForumEmbedJob {
  chunk: EmbeddedForumChunk;
  postId: string;
  threadId: string;
}

// ============================================================================
// UTILITY
// ============================================================================

function jitteredBackoff(attempt: number, baseMs: number = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * exponential * 0.5;
  return Math.min(exponential + jitter, 30000);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// FORUM INGESTION PIPELINE
// ============================================================================

export class ForumIngestionPipeline extends EventEmitter {
  private config: ForumIngestionConfig;
  private progress: IngestionProgress | null = null;
  private embeddingPool: WorkerPool<ForumChunkJob> | null = null;
  private upsertPool: WorkerPool<ForumEmbedJob> | null = null;
  private diagnostics: ForumPipelineDiagnostics;
  
  private successCount = 0;
  private failedPosts: ForumIngestionReport['failedPosts'] = [];
  private processedCount = 0;
  private totalChunks = 0;
  private skippedPosts = 0;
  private previousFingerprints = new Map<string, string>();

  constructor(config: Partial<ForumIngestionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FORUM_CONFIG, ...config };
    this.diagnostics = createDiagnostics();
  }

  /**
   * Embedding worker processor with rate-limit handling.
   */
  private async processEmbedding(job: ForumChunkJob): Promise<void> {
    const { chunk, postId, threadId } = job;
    
    this.diagnostics.embeddingInFlight++;
    this.diagnostics.peakEmbeddingInFlight = Math.max(
      this.diagnostics.peakEmbeddingInFlight,
      this.diagnostics.embeddingInFlight
    );
    
    const embedStart = Date.now();
    
    try {
      const embedResult = await this.embedWithRateLimitHandling(chunk);
      
      this.diagnostics.embeddingLatencies.push(Date.now() - embedStart);
      
      if (!embedResult.success || !embedResult.embedding) {
        this.handleEmbedFailure(chunk, postId, threadId, embedResult.error || 'Unknown error');
        return;
      }
      
      // Push to upsert pool
      this.upsertPool!.push({
        chunk: { ...chunk, embedding: embedResult.embedding },
        postId,
        threadId,
      });
    } finally {
      this.diagnostics.embeddingInFlight--;
    }
  }

  /**
   * Embed with jittered backoff on rate limits.
   */
  private async embedWithRateLimitHandling(
    chunk: ForumChunk,
    attempt: number = 1
  ): Promise<{ success: boolean; embedding?: number[]; error?: string }> {
    const maxAttempts = 5;
    
    try {
      // Use the existing embedSingleChunk which handles the API call
      const result = await embedSingleChunk({
        id: chunk.id,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        metadata: {
          source_file: `forum/${chunk.metadata.threadId}/${chunk.metadata.postId}`,
          doc_title: chunk.metadata.threadTitle,
          section_title: `Post by ${chunk.metadata.username}`,
          doc_category: chunk.metadata.forumCategory,
          url_path: chunk.metadata.anchor,
          chunk_index: chunk.metadata.subChunkIndex,
          content_hash: chunk.metadata.fingerprint,
          last_modified: chunk.metadata.date,
          embedding_model: chunk.metadata.embeddingModel,
        },
      });
      
      if (result.success && result.chunk) {
        return { success: true, embedding: result.chunk.embedding };
      }
      
      return { success: false, error: result.error };
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || 
                          error?.message?.includes('429') ||
                          error?.message?.toLowerCase().includes('rate limit');
      
      if (isRateLimit && attempt < maxAttempts) {
        this.diagnostics.rateLimitHits++;
        const backoffMs = jitteredBackoff(attempt);
        
        logger.warn({
          attempt,
          backoffMs,
          postId: chunk.metadata.postId,
        }, 'Rate limited, backing off');
        
        this.diagnostics.retryCount++;
        await sleep(backoffMs);
        return this.embedWithRateLimitHandling(chunk, attempt + 1);
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private handleEmbedFailure(
    chunk: ForumChunk,
    postId: string,
    threadId: string,
    error: string
  ): void {
    this.failedPosts.push({
      threadId,
      postId,
      reason: error,
    });
    
    if (this.progress) {
      markChunkFailedBatched(
        this.progress,
        `forum/${threadId}/${postId}`,
        chunk.metadata.subChunkIndex,
        chunk.id,
        error
      );
    }
    
    this.config.onPostComplete?.(postId, false, error);
  }

  /**
   * Upsert worker processor.
   */
  private async processUpsert(job: ForumEmbedJob): Promise<void> {
    const { chunk, postId, threadId } = job;
    
    this.diagnostics.upsertInFlight++;
    this.diagnostics.peakUpsertInFlight = Math.max(
      this.diagnostics.peakUpsertInFlight,
      this.diagnostics.upsertInFlight
    );
    
    try {
      // Build payload with forum-specific metadata
      const payload: Record<string, unknown> = {
        // Core identity
        threadId: chunk.metadata.threadId,
        postId: chunk.metadata.postId,
        subChunkIndex: chunk.metadata.subChunkIndex,
        
        // Author info
        username: chunk.metadata.username,
        userId: chunk.metadata.userId,
        date: chunk.metadata.date,
        
        // Thread context
        threadTitle: chunk.metadata.threadTitle,
        forumCategory: chunk.metadata.forumCategory,
        forumPath: chunk.metadata.forumPath,
        page: chunk.metadata.page,
        anchor: chunk.metadata.anchor,
        
        // Content metadata
        keywords: chunk.metadata.keywords,
        mentions: chunk.metadata.mentions,
        hasLinks: chunk.metadata.hasLinks,
        hasImages: chunk.metadata.hasImages,
        contentLength: chunk.metadata.contentLength,
        
        // For retrieval
        content: chunk.content,
        chunkType: chunk.metadata.chunkType,
        fingerprint: chunk.metadata.fingerprint,
        embeddingModel: chunk.metadata.embeddingModel,
        
        // Type marker for filtering
        docType: 'forum_post',
      };
      
      // Add images if present
      if (chunk.metadata.images && chunk.metadata.images.length > 0) {
        payload.images = chunk.metadata.images;
      }
      
      await upsertVectors([{
        id: chunk.id,
        vector: chunk.embedding,
        payload,
      }]);
      
      this.successCount++;
      this.processedCount++;
      
      if (this.progress) {
        markChunkProcessedBatched(
          this.progress,
          `forum/${threadId}/${postId}`,
          chunk.metadata.subChunkIndex
        );
      }
      
      this.config.onProgress?.(
        this.processedCount,
        this.totalChunks,
        threadId,
        postId
      );
      
      // Log progress periodically
      if (this.processedCount % 100 === 0) {
        logger.info({
          processed: this.processedCount,
          total: this.totalChunks,
          success: this.successCount,
          failed: this.failedPosts.length,
          embeddingInFlight: this.diagnostics.embeddingInFlight,
        }, 'Forum pipeline progress');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      this.failedPosts.push({
        threadId,
        postId,
        reason: `Upsert failed: ${errorMsg}`,
      });
      
      if (this.progress) {
        markChunkFailedBatched(
          this.progress,
          `forum/${threadId}/${postId}`,
          chunk.metadata.subChunkIndex,
          chunk.id,
          `Upsert failed: ${errorMsg}`
        );
      }
    } finally {
      this.diagnostics.upsertInFlight--;
    }
  }

  /**
   * Load previous fingerprints for incremental ingestion.
   */
  private async loadPreviousFingerprints(): Promise<void> {
    // This would typically load from state store
    // For now, we'll use the progress tracker's file state
    // In production, you'd want a dedicated forum state table
    this.previousFingerprints.clear();
  }

  /**
   * Run the forum ingestion pipeline.
   */
  async run(sourcePath?: string): Promise<ForumIngestionReport> {
    const startTime = Date.now();
    const sessionId = generateSessionId();
    this.diagnostics = createDiagnostics();
    
    logger.info({
      config: {
        maxTokens: this.config.maxTokens,
        embeddingThreads: this.config.embeddingThreads,
        upsertThreads: this.config.upsertThreads,
        embedQuotedContent: this.config.embedQuotedContent,
        skipUnchangedPosts: this.config.skipUnchangedPosts,
      },
      sourcePath,
    }, 'Starting forum ingestion pipeline');
    
    try {
      await initStateStore();
      
      // Read forum threads
      const threads = sourcePath
        ? await readForumThreadsFromDirectory(sourcePath)
        : await readAllForumThreads();
      
      if (threads.length === 0) {
        logger.warn('No forum threads found');
        return this.buildReport(sessionId, startTime, 0, 0);
      }
      
      logger.info({
        threads: threads.length,
        totalPosts: threads.reduce((sum, t) => sum + t.posts.length, 0),
      }, 'Loaded forum threads');
      
      // Extract and filter posts
      let posts = extractAllPosts(threads);
      posts = filterSubstantivePosts(posts);
      
      // Skip unchanged posts if configured
      if (this.config.skipUnchangedPosts) {
        await this.loadPreviousFingerprints();
        const { changed, unchanged } = filterChangedPosts(posts, this.previousFingerprints);
        this.skippedPosts = unchanged.length;
        posts = changed;
        
        logger.info({
          changed: changed.length,
          skipped: unchanged.length,
        }, 'Filtered unchanged posts');
      }
      
      if (posts.length === 0) {
        logger.info('No posts to process (all unchanged)');
        return this.buildReport(sessionId, startTime, threads.length, 0);
      }
      
      // Chunk all posts
      const allChunks: { chunk: ForumChunk; post: ForumPost }[] = [];
      
      for (const post of posts) {
        const chunks = chunkForumPost(post, this.config, 'original');
        for (const chunk of chunks) {
          allChunks.push({ chunk, post });
        }
        
        // Optionally chunk quoted content
        if (this.config.embedQuotedContent) {
          const quotedChunks = chunkQuotedContent(post, this.config);
          for (const chunk of quotedChunks) {
            allChunks.push({ chunk, post });
          }
        }
      }
      
      this.totalChunks = allChunks.length;
      
      logger.info({
        posts: posts.length,
        chunks: this.totalChunks,
      }, 'Chunked all posts');
      
      // Initialize progress
      this.progress = createProgress(sessionId, threads.length, this.totalChunks);
      await saveProgressBatched(this.progress);
      
      // Initialize worker pools
      this.upsertPool = new WorkerPool<ForumEmbedJob>(
        this.config.upsertThreads,
        (job) => this.processUpsert(job),
        'forum-upsert'
      );
      
      this.embeddingPool = new WorkerPool<ForumChunkJob>(
        this.config.embeddingThreads,
        (job) => this.processEmbedding(job),
        'forum-embedding'
      );
      
      // Push all chunks to embedding pool (non-blocking)
      for (const { chunk, post } of allChunks) {
        this.embeddingPool.push({
          chunk,
          postId: post.postId,
          threadId: post.threadId,
        });
      }
      
      // Wait for completion
      await this.embeddingPool.drain();
      await this.upsertPool.drain();
      
      // Close pools
      this.embeddingPool.close();
      this.upsertPool.close();
      
      // Flush pending writes
      await flushProgress(this.progress);
      await flushStateStore();
      
      // Clear progress on success
      if (this.failedPosts.length === 0) {
        await clearProgress();
      }
      
      return this.buildReport(sessionId, startTime, threads.length, posts.length);
    } finally {
      await closeStateStore();
    }
  }

  private buildReport(
    sessionId: string,
    startTime: number,
    threadsProcessed: number,
    postsProcessed: number
  ): ForumIngestionReport {
    const durationMs = Date.now() - startTime;
    const vectorsPerSecond = durationMs > 0
      ? Math.round(this.successCount / (durationMs / 1000))
      : 0;
    
    const avgLatency = this.diagnostics.embeddingLatencies.length > 0
      ? Math.round(
          this.diagnostics.embeddingLatencies.reduce((a, b) => a + b, 0) /
          this.diagnostics.embeddingLatencies.length
        )
      : 0;
    
    const report: ForumIngestionReport = {
      sessionId,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs,
      threadsProcessed,
      postsProcessed,
      chunksEmbedded: this.successCount,
      postsSkipped: this.skippedPosts,
      failedPosts: this.failedPosts,
      diagnostics: {
        peakEmbeddingInFlight: this.diagnostics.peakEmbeddingInFlight,
        avgEmbeddingLatencyMs: avgLatency,
        rateLimitHits: this.diagnostics.rateLimitHits,
        vectorsPerSecond,
      },
    };
    
    logger.info({
      ...report,
      failedPosts: report.failedPosts.length,
    }, 'Forum ingestion complete');
    
    return report;
  }
}

/**
 * Run forum ingestion with the given configuration.
 */
export async function runForumPipeline(
  config: Partial<ForumIngestionConfig> = {},
  sourcePath?: string
): Promise<ForumIngestionReport> {
  const pipeline = new ForumIngestionPipeline(config);
  return pipeline.run(sourcePath);
}
