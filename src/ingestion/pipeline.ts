/**
 * Production-grade multi-threaded RAG ingestion pipeline.
 * 
 * Architecture:
 * - Producer: walks files, chunks content, pushes to bounded queue
 * - Embedding Workers: fixed-size pool pulling from queue concurrently
 * - Upsert Workers: fixed-size pool for vector DB operations
 * 
 * Guarantees:
 * - True parallelism with independent workers
 * - Bounded worker pools (no unbounded threads)
 * - Single chunk failure doesn't halt ingestion
 * - Batched async progress persistence
 * - Resumable from last successful chunk
 * - Deterministic chunk IDs for idempotent retries
 */

import { EventEmitter } from 'events';
import { logger } from '../config/index.js';
import { readAllDocs, type DocFile } from './document-reader.js';
import { chunkDocument, countTokens, type DocChunk, type ChunkerConfig } from './chunker.js';
import { embedSingleChunk, type EmbeddedChunk } from './embedder.js';
import {
  loadProgress,
  saveProgressBatched,
  createProgress,
  initFileProgress,
  markChunkProcessedBatched,
  markChunkFailedBatched,
  markFileCompleted,
  clearProgress,
  generateSessionId,
  getResumeChunkIndex,
  flushProgress,
  type IngestionProgress,
} from './progress-tracker.js';
import {
  initStateStore,
  updateFileStateBatched,
  clearAllState,
  closeStateStore,
  flushStateStore,
} from './state-store.js';
import {
  ensureCollection,
  upsertVectors,
  deleteVectorsByFilter,
  getCollectionInfo,
  getQdrantClient,
} from '../services/qdrant.js';
import { createHash } from 'crypto';

// ============================================================================
// DIAGNOSTICS - Required instrumentation for parallelism verification
// ============================================================================

interface PipelineDiagnostics {
  embeddingInFlight: number;
  upsertInFlight: number;
  embeddingLatencies: number[];
  rateLimitHits: number;
  retryCount: number;
  timeInChunking: number;
  timeInEmbedding: number;
  timeInUpsert: number;
  timeInProgressPersist: number;
  peakEmbeddingInFlight: number;
  peakUpsertInFlight: number;
  startTime: number;
}

function createDiagnostics(): PipelineDiagnostics {
  return {
    embeddingInFlight: 0,
    upsertInFlight: 0,
    embeddingLatencies: [],
    rateLimitHits: 0,
    retryCount: 0,
    timeInChunking: 0,
    timeInEmbedding: 0,
    timeInUpsert: 0,
    timeInProgressPersist: 0,
    peakEmbeddingInFlight: 0,
    peakUpsertInFlight: 0,
    startTime: Date.now(),
  };
}

function logDiagnostics(diag: PipelineDiagnostics, label: string): void {
  const avgLatency = diag.embeddingLatencies.length > 0
    ? Math.round(diag.embeddingLatencies.reduce((a, b) => a + b, 0) / diag.embeddingLatencies.length)
    : 0;
  
  logger.info({
    label,
    embeddingInFlight: diag.embeddingInFlight,
    upsertInFlight: diag.upsertInFlight,
    peakEmbeddingInFlight: diag.peakEmbeddingInFlight,
    peakUpsertInFlight: diag.peakUpsertInFlight,
    avgEmbeddingLatencyMs: avgLatency,
    rateLimitHits: diag.rateLimitHits,
    retryCount: diag.retryCount,
    timeInChunkingMs: Math.round(diag.timeInChunking),
    timeInEmbeddingMs: Math.round(diag.timeInEmbedding),
    timeInUpsertMs: Math.round(diag.timeInUpsert),
    timeInProgressPersistMs: Math.round(diag.timeInProgressPersist),
  }, 'Pipeline diagnostics');
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface PipelineConfig {
  maxChunkTokens: number;
  chunkOverlapTokens: number;
  absoluteMaxTokens: number;
  embeddingModel: string;
  embeddingThreads: number;
  upsertThreads: number;
  failFastValidation: boolean;
  resume: boolean;
  onProgress?: (current: number, total: number, file: string, stage: string) => void;
  onChunkComplete?: (chunkId: string, success: boolean, error?: string) => void;
}

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  maxChunkTokens: 800,
  chunkOverlapTokens: 120,
  absoluteMaxTokens: 1024,
  embeddingModel: 'text-embedding-3-small',
  embeddingThreads: 6,
  upsertThreads: 4,
  failFastValidation: false,
  resume: false,
};

export interface PipelineReport {
  sessionId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalFilesProcessed: number;
  totalChunksEmbedded: number;
  failedChunks: Array<{
    file: string;
    chunkIndex: number;
    chunkId: string;
    reason: string;
  }>;
  summary: {
    success: boolean;
    filesScanned: number;
    filesUpdated: number;
    chunksUpserted: number;
    errorCount: number;
  };
  diagnostics?: {
    peakEmbeddingInFlight: number;
    peakUpsertInFlight: number;
    avgEmbeddingLatencyMs: number;
    rateLimitHits: number;
    vectorsPerSecond: number;
  };
}

// ============================================================================
// JOB TYPES
// ============================================================================

interface ChunkJob {
  chunk: DocChunk;
  filePath: string;
  tokenCount: number; // Pre-computed, no re-tokenization
}

interface EmbedJob {
  chunk: EmbeddedChunk;
  filePath: string;
}

// ============================================================================
// BOUNDED CONCURRENT WORKER POOL
// Implements true producer-consumer with independent concurrent workers
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

  /**
   * Push item to queue. Does NOT await processing.
   * Workers pull independently and concurrently.
   */
  push(item: T): void {
    if (this.closed) throw new Error(`${this.name} pool is closed`);
    this.queue.push(item);
    this.spawnWorkerIfNeeded();
  }

  /**
   * Spawn a new worker if under limit and queue has items.
   * Each worker runs independently until queue is empty.
   */
  private spawnWorkerIfNeeded(): void {
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      this.activeWorkers++;
      this.runWorker();
    }
  }

  /**
   * Worker loop - pulls items until queue is empty.
   * Runs completely independently of other workers.
   */
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

  /**
   * Wait for all workers to finish and queue to empty.
   */
  async drain(): Promise<void> {
    if (this.activeWorkers === 0 && this.queue.length === 0) {
      return;
    }
    return new Promise(resolve => {
      this.resolveIdle = resolve;
      // Ensure workers are spawned if queue has items
      this.spawnWorkerIfNeeded();
    });
  }

  close(): void {
    this.closed = true;
  }

  get inFlight(): number {
    return this.activeWorkers;
  }

  get pending(): number {
    return this.queue.length;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function jitteredBackoff(attempt: number, baseMs: number = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * exponential * 0.5;
  return Math.min(exponential + jitter, 30000); // Cap at 30s
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// INGESTION PIPELINE
// ============================================================================

export class IngestionPipeline extends EventEmitter {
  private config: PipelineConfig;
  private progress: IngestionProgress | null = null;
  private embeddingPool: WorkerPool<ChunkJob> | null = null;
  private upsertPool: WorkerPool<EmbedJob> | null = null;
  private diagnostics: PipelineDiagnostics;
  
  private successCount = 0;
  private failedChunks: PipelineReport['failedChunks'] = [];
  private processedCount = 0;
  private totalChunks = 0;

  constructor(config: Partial<PipelineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.diagnostics = createDiagnostics();
  }

  /**
   * Validate chunk before embedding.
   */
  private validateChunk(chunk: DocChunk): { valid: boolean; error?: string } {
    const { absoluteMaxTokens, failFastValidation } = this.config;
    
    if (chunk.tokenCount > absoluteMaxTokens) {
      const error = `Chunk exceeds absolute max tokens: ${chunk.tokenCount} > ${absoluteMaxTokens}`;
      
      if (failFastValidation) {
        return { valid: false, error };
      }
      
      logger.warn({
        file: chunk.metadata.source_file,
        chunkIndex: chunk.metadata.chunk_index,
        tokenCount: chunk.tokenCount,
        absoluteMax: absoluteMaxTokens,
      }, 'Chunk exceeds absolute max - processing anyway');
    }
    
    return { valid: true };
  }

  /**
   * Embedding worker processor with rate-limit handling.
   */
  private async processEmbedding(job: ChunkJob): Promise<void> {
    const { chunk, filePath } = job;
    const chunkIndex = chunk.metadata.chunk_index;
    
    // Track in-flight
    this.diagnostics.embeddingInFlight++;
    this.diagnostics.peakEmbeddingInFlight = Math.max(
      this.diagnostics.peakEmbeddingInFlight,
      this.diagnostics.embeddingInFlight
    );
    
    const embedStart = Date.now();
    
    try {
      // Validate (token count already computed, no re-tokenization)
      const validation = this.validateChunk(chunk);
      if (!validation.valid) {
        this.handleEmbedFailure(chunk, filePath, chunkIndex, validation.error || 'Validation failed');
        return;
      }
      
      // Embed with rate-limit aware retry
      const embedResult = await this.embedWithRateLimitHandling(chunk);
      
      const embedEnd = Date.now();
      this.diagnostics.embeddingLatencies.push(embedEnd - embedStart);
      this.diagnostics.timeInEmbedding += (embedEnd - embedStart);
      
      if (!embedResult.success || !embedResult.chunk) {
        this.handleEmbedFailure(chunk, filePath, chunkIndex, embedResult.error || 'Unknown embedding error');
        return;
      }
      
      // Push to upsert pool (non-blocking)
      this.upsertPool!.push({
        chunk: embedResult.chunk,
        filePath,
      });
    } finally {
      this.diagnostics.embeddingInFlight--;
    }
  }

  /**
   * Embed with jittered backoff on rate limits.
   */
  private async embedWithRateLimitHandling(
    chunk: DocChunk,
    attempt: number = 1
  ): Promise<{ success: boolean; chunk?: EmbeddedChunk; error?: string }> {
    const maxAttempts = 5;
    
    try {
      const result = await embedSingleChunk(chunk);
      return result;
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || 
                          error?.message?.includes('429') ||
                          error?.message?.toLowerCase().includes('rate limit');
      
      if (isRateLimit) {
        this.diagnostics.rateLimitHits++;
        
        if (attempt < maxAttempts) {
          const backoffMs = jitteredBackoff(attempt);
          logger.warn({
            attempt,
            backoffMs,
            file: chunk.metadata.source_file,
            chunkIndex: chunk.metadata.chunk_index,
          }, 'Rate limited, backing off with jitter');
          
          this.diagnostics.retryCount++;
          await sleep(backoffMs);
          return this.embedWithRateLimitHandling(chunk, attempt + 1);
        }
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private handleEmbedFailure(
    chunk: DocChunk,
    filePath: string,
    chunkIndex: number,
    error: string
  ): void {
    this.failedChunks.push({
      file: filePath,
      chunkIndex,
      chunkId: chunk.id,
      reason: error,
    });
    
    if (this.progress) {
      markChunkFailedBatched(this.progress, filePath, chunkIndex, chunk.id, error);
    }
    
    this.config.onChunkComplete?.(chunk.id, false, error);
  }

  /**
   * Upsert worker processor.
   */
  private async processUpsert(job: EmbedJob): Promise<void> {
    const { chunk, filePath } = job;
    const chunkIndex = chunk.metadata.chunk_index;
    
    // Track in-flight
    this.diagnostics.upsertInFlight++;
    this.diagnostics.peakUpsertInFlight = Math.max(
      this.diagnostics.peakUpsertInFlight,
      this.diagnostics.upsertInFlight
    );
    
    const upsertStart = Date.now();
    
    try {
      await upsertVectors([{
        id: chunk.id,
        vector: chunk.embedding,
        payload: { ...chunk.metadata, content: chunk.content },
      }]);
      
      this.diagnostics.timeInUpsert += (Date.now() - upsertStart);
      
      this.successCount++;
      this.processedCount++;
      
      // Batched progress persistence (non-blocking)
      if (this.progress) {
        const persistStart = Date.now();
        markChunkProcessedBatched(this.progress, filePath, chunkIndex);
        this.diagnostics.timeInProgressPersist += (Date.now() - persistStart);
      }
      
      this.config.onProgress?.(
        this.processedCount,
        this.totalChunks,
        filePath,
        'upsert'
      );
      
      this.config.onChunkComplete?.(chunk.id, true);
      
      // Log progress periodically
      if (this.processedCount % 50 === 0) {
        logger.info({
          processed: this.processedCount,
          total: this.totalChunks,
          success: this.successCount,
          failed: this.failedChunks.length,
          embeddingInFlight: this.diagnostics.embeddingInFlight,
          upsertInFlight: this.diagnostics.upsertInFlight,
        }, 'Pipeline progress');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      this.failedChunks.push({
        file: filePath,
        chunkIndex,
        chunkId: chunk.id,
        reason: `Upsert failed: ${errorMsg}`,
      });
      
      if (this.progress) {
        markChunkFailedBatched(
          this.progress,
          filePath,
          chunkIndex,
          chunk.id,
          `Upsert failed: ${errorMsg}`
        );
      }
      
      this.config.onChunkComplete?.(chunk.id, false, errorMsg);
    } finally {
      this.diagnostics.upsertInFlight--;
    }
  }

  /**
   * Run the full ingestion pipeline.
   */
  async run(): Promise<PipelineReport> {
    const startTime = Date.now();
    const sessionId = generateSessionId();
    this.diagnostics = createDiagnostics();
    
    logger.info({
      config: {
        maxChunkTokens: this.config.maxChunkTokens,
        absoluteMaxTokens: this.config.absoluteMaxTokens,
        embeddingThreads: this.config.embeddingThreads,
        upsertThreads: this.config.upsertThreads,
        resume: this.config.resume,
      },
    }, 'Starting ingestion pipeline');
    
    // Check for existing progress
    let existingProgress: IngestionProgress | null = null;
    if (this.config.resume) {
      existingProgress = await loadProgress();
      if (existingProgress) {
        logger.info({
          sessionId: existingProgress.sessionId,
          processedChunks: existingProgress.processedChunks,
          totalChunks: existingProgress.totalChunks,
        }, 'Resuming from previous ingestion');
      }
    }
    
    try {
      await initStateStore();
      
      // Fresh start: clear collection
      if (!existingProgress) {
        const qdrant = getQdrantClient();
        const collectionName = process.env.QDRANT_COLLECTION || 'docs';
        
        try {
          const info = await getCollectionInfo();
          if (info) {
            logger.info({ collection: collectionName }, 'Deleting existing collection');
            await qdrant.deleteCollection(collectionName);
          }
        } catch {
          // Collection doesn't exist
        }
        
        await clearAllState();
        await clearProgress();
      }
      
      await ensureCollection();
      
      // Stage 1: Read all documents
      const docs = await readAllDocs();
      logger.info({ files: docs.length }, 'Read all documents');
      
      // Stage 2: Chunk all documents (measure time)
      const chunkStart = Date.now();
      const chunkConfig: Partial<ChunkerConfig> = {
        maxTokens: this.config.maxChunkTokens,
        overlapTokens: this.config.chunkOverlapTokens,
        absoluteMaxTokens: this.config.absoluteMaxTokens,
        embeddingModel: this.config.embeddingModel,
      };
      
      const fileChunksMap = new Map<string, DocChunk[]>();
      this.totalChunks = 0;
      
      for (const doc of docs) {
        const chunks = chunkDocument(doc, chunkConfig);
        fileChunksMap.set(doc.filePath, chunks);
        this.totalChunks += chunks.length;
      }
      
      this.diagnostics.timeInChunking = Date.now() - chunkStart;
      
      logger.info({
        files: docs.length,
        totalChunks: this.totalChunks,
        chunkingTimeMs: this.diagnostics.timeInChunking,
      }, 'Chunked all documents');

      // Initialize progress tracking
      if (existingProgress) {
        this.progress = existingProgress;
        this.progress.totalFiles = docs.length;
        this.progress.totalChunks = this.totalChunks;
      } else {
        this.progress = createProgress(sessionId, docs.length, this.totalChunks);
        
        for (const [filePath, chunks] of fileChunksMap) {
          initFileProgress(this.progress, filePath, chunks.length);
        }
        
        await saveProgressBatched(this.progress);
      }
      
      // Initialize worker pools with TRUE concurrent workers
      this.upsertPool = new WorkerPool<EmbedJob>(
        this.config.upsertThreads,
        (job) => this.processUpsert(job),
        'upsert'
      );
      
      this.embeddingPool = new WorkerPool<ChunkJob>(
        this.config.embeddingThreads,
        (job) => this.processEmbedding(job),
        'embedding'
      );
      
      // Stage 3: Push ALL chunks to embedding pool (producer)
      // Producer does NOT await embedding or upsert - just pushes to queue
      for (const doc of docs) {
        const filePath = doc.filePath;
        const chunks = fileChunksMap.get(filePath) || [];
        
        // Get resume point
        const startIndex = getResumeChunkIndex(existingProgress, filePath);
        
        if (startIndex >= chunks.length) {
          logger.debug({ file: filePath }, 'File already processed, skipping');
          continue;
        }
        
        if (startIndex > 0) {
          logger.info({ file: filePath, resumeFrom: startIndex }, 'Resuming file');
        }
        
        // Delete existing vectors for fresh files (async, don't block)
        if (startIndex === 0) {
          deleteVectorsByFilter({
            must: [{ key: 'source_file', match: { value: filePath } }],
          }).catch(() => { /* Ignore if no vectors exist */ });
        }
        
        // Push ALL chunks to queue immediately (non-blocking)
        for (let i = startIndex; i < chunks.length; i++) {
          const chunk = chunks[i];
          
          // Token count already computed during chunking - no re-tokenization
          this.embeddingPool.push({
            chunk,
            filePath,
            tokenCount: chunk.tokenCount,
          });
        }
      }
      
      // Log initial diagnostics
      logDiagnostics(this.diagnostics, 'after-queue-fill');
      
      // Wait for all embedding workers to complete
      await this.embeddingPool.drain();
      logDiagnostics(this.diagnostics, 'after-embedding-drain');
      
      // Wait for all upsert workers to complete
      await this.upsertPool.drain();
      logDiagnostics(this.diagnostics, 'after-upsert-drain');
      
      // Close pools
      this.embeddingPool.close();
      this.upsertPool.close();
      
      // Flush any pending progress/state writes
      await flushProgress(this.progress);
      await flushStateStore();
      
      // Update file states in batch
      for (const doc of docs) {
        const filePath = doc.filePath;
        const chunks = fileChunksMap.get(filePath) || [];
        const contentHash = hashFileContent(doc.content);
        const chunkIds = chunks.map(c => c.id);
        await updateFileStateBatched(filePath, contentHash, chunkIds);
        await markFileCompleted(this.progress!, filePath);
      }
      
      // Final flush
      await flushStateStore();
      await flushProgress(this.progress);
      
      // Generate report
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;
      const vectorsPerSecond = durationMs > 0 ? Math.round(this.successCount / (durationMs / 1000)) : 0;
      
      const avgLatency = this.diagnostics.embeddingLatencies.length > 0
        ? Math.round(this.diagnostics.embeddingLatencies.reduce((a, b) => a + b, 0) / this.diagnostics.embeddingLatencies.length)
        : 0;
      
      const report: PipelineReport = {
        sessionId: this.progress.sessionId,
        startedAt: this.progress.startedAt,
        completedAt,
        durationMs,
        totalFilesProcessed: docs.length,
        totalChunksEmbedded: this.successCount,
        failedChunks: this.failedChunks,
        summary: {
          success: this.failedChunks.length === 0,
          filesScanned: docs.length,
          filesUpdated: docs.length,
          chunksUpserted: this.successCount,
          errorCount: this.failedChunks.length,
        },
        diagnostics: {
          peakEmbeddingInFlight: this.diagnostics.peakEmbeddingInFlight,
          peakUpsertInFlight: this.diagnostics.peakUpsertInFlight,
          avgEmbeddingLatencyMs: avgLatency,
          rateLimitHits: this.diagnostics.rateLimitHits,
          vectorsPerSecond,
        },
      };
      
      // Clear progress on success
      if (this.failedChunks.length === 0) {
        await clearProgress();
      }
      
      // Final diagnostics log
      logDiagnostics(this.diagnostics, 'final');
      
      logger.info({
        ...report.summary,
        durationMs,
        durationSec: Math.round(durationMs / 1000),
        vectorsPerSecond,
        peakEmbeddingInFlight: this.diagnostics.peakEmbeddingInFlight,
        peakUpsertInFlight: this.diagnostics.peakUpsertInFlight,
      }, 'Pipeline complete');
      
      return report;
    } finally {
      await closeStateStore();
    }
  }
}

/**
 * Run the ingestion pipeline with the given configuration.
 */
export async function runPipeline(
  config: Partial<PipelineConfig> = {}
): Promise<PipelineReport> {
  const pipeline = new IngestionPipeline(config);
  return pipeline.run();
}
