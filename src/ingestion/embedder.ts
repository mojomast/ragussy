import { embedText } from '../services/llm.js';
import { logger } from '../config/index.js';
import type { DocChunk } from './chunker.js';

const RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000;

// Token count cache to avoid re-tokenization
const tokenCountCache = new Map<string, number>();

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Jittered exponential backoff for rate limit handling.
 */
function jitteredBackoff(attempt: number): number {
  const exponential = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * exponential * 0.5;
  return Math.min(exponential + jitter, 30000); // Cap at 30s
}

/**
 * Check if error is a rate limit (429) response.
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  // Check status code
  if (error.status === 429) return true;
  if (error.statusCode === 429) return true;
  
  // Check error message
  const message = error.message?.toLowerCase() || '';
  if (message.includes('429')) return true;
  if (message.includes('rate limit')) return true;
  if (message.includes('too many requests')) return true;
  if (message.includes('quota exceeded')) return true;
  
  // Check response body
  const body = error.body?.toLowerCase() || error.response?.data?.toLowerCase() || '';
  if (body.includes('rate limit')) return true;
  
  return false;
}

export interface EmbeddedChunk extends DocChunk {
  embedding: number[];
}

export interface EmbedResult {
  chunk: EmbeddedChunk | null;
  success: boolean;
  error?: string;
  retryCount?: number;
  wasRateLimited?: boolean;
}

/**
 * Get cached token count or return the chunk's stored count.
 * Avoids re-tokenization.
 */
export function getCachedTokenCount(chunk: DocChunk): number {
  const cached = tokenCountCache.get(chunk.id);
  if (cached !== undefined) return cached;
  
  // Use the pre-computed token count from chunking
  tokenCountCache.set(chunk.id, chunk.tokenCount);
  return chunk.tokenCount;
}

/**
 * Embed a single chunk with retry logic and rate-limit handling.
 */
async function embedSingleChunkWithRetry(
  chunk: DocChunk,
  attempt = 1,
  totalRetries = 0,
  wasRateLimited = false
): Promise<EmbedResult> {
  try {
    const embedding = await embedText(chunk.content);
    
    return {
      chunk: { ...chunk, embedding },
      success: true,
      retryCount: totalRetries,
      wasRateLimited,
    };
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const isRateLimit = isRateLimitError(error);
    
    if (isRateLimit) {
      wasRateLimited = true;
      
      if (attempt < RETRY_ATTEMPTS) {
        const delay = jitteredBackoff(attempt);
        
        logger.warn({
          attempt,
          maxAttempts: RETRY_ATTEMPTS,
          backoffMs: delay,
          file: chunk.metadata.source_file,
          chunkIndex: chunk.metadata.chunk_index,
        }, 'Rate limited (429), backing off with jitter');
        
        await sleep(delay);
        return embedSingleChunkWithRetry(chunk, attempt + 1, totalRetries + 1, wasRateLimited);
      }
      
      logger.error({
        error: errorMsg,
        attempts: attempt,
        file: chunk.metadata.source_file,
        chunkIndex: chunk.metadata.chunk_index,
      }, 'Rate limit retries exhausted');
      
      return {
        chunk: null,
        success: false,
        error: `Rate limit exceeded after ${attempt} attempts: ${errorMsg}`,
        retryCount: totalRetries,
        wasRateLimited: true,
      };
    }
    
    // Non-rate-limit error - still retry with backoff
    if (attempt < RETRY_ATTEMPTS) {
      const delay = jitteredBackoff(attempt);
      
      logger.warn({
        error: errorMsg,
        attempt,
        retryIn: delay,
        file: chunk.metadata.source_file,
        chunkIndex: chunk.metadata.chunk_index,
      }, 'Embedding failed, retrying');
      
      await sleep(delay);
      return embedSingleChunkWithRetry(chunk, attempt + 1, totalRetries + 1, wasRateLimited);
    }
    
    logger.error({
      error: errorMsg,
      attempt,
      file: chunk.metadata.source_file,
      chunkIndex: chunk.metadata.chunk_index,
    }, 'Failed to embed chunk after retries');
    
    return {
      chunk: null,
      success: false,
      error: errorMsg,
      retryCount: totalRetries,
      wasRateLimited,
    };
  }
}

/**
 * Embed a single chunk. One API call per chunk - no batching.
 * Token count is pre-computed during chunking - no re-tokenization.
 */
export async function embedSingleChunk(chunk: DocChunk): Promise<EmbedResult> {
  return embedSingleChunkWithRetry(chunk);
}

/**
 * Legacy batch embedding function for backwards compatibility.
 * Note: For production RAG pipeline, use embedSingleChunk instead.
 */
export async function embedChunks(
  chunks: DocChunk[],
  onProgress?: (completed: number, total: number) => void
): Promise<EmbeddedChunk[]> {
  const embeddedChunks: EmbeddedChunk[] = [];
  
  logger.info({ chunks: chunks.length }, 'Starting embedding process (one chunk at a time)');
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const result = await embedSingleChunk(chunk);
    
    if (result.success && result.chunk) {
      embeddedChunks.push(result.chunk);
    } else {
      logger.error({
        file: chunk.metadata.source_file,
        chunkIndex: chunk.metadata.chunk_index,
        error: result.error,
      }, 'Skipping failed chunk');
    }
    
    onProgress?.(i + 1, chunks.length);
    
    // Small delay between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await sleep(50);
    }
  }
  
  logger.info({ embedded: embeddedChunks.length, total: chunks.length }, 'Embedding complete');
  return embeddedChunks;
}
