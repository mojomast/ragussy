import { embedTexts } from '../services/llm.js';
import { logger } from '../config/index.js';
import type { DocChunk } from './chunker.js';

const BATCH_SIZE = 50;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function embedBatchWithRetry(
  texts: string[],
  attempt = 1
): Promise<number[][]> {
  try {
    return await embedTexts(texts);
  } catch (error) {
    if (attempt >= RETRY_ATTEMPTS) {
      logger.error({ error, attempt }, 'Failed to embed batch after retries');
      throw error;
    }
    
    const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    logger.warn({ error, attempt, retryIn: delay }, 'Embedding failed, retrying');
    
    await sleep(delay);
    return embedBatchWithRetry(texts, attempt + 1);
  }
}

export interface EmbeddedChunk extends DocChunk {
  embedding: number[];
}

export async function embedChunks(
  chunks: DocChunk[],
  onProgress?: (completed: number, total: number) => void
): Promise<EmbeddedChunk[]> {
  const embeddedChunks: EmbeddedChunk[] = [];
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  
  logger.info({ chunks: chunks.length, batches: totalBatches }, 'Starting embedding process');
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    
    logger.debug({ batch: batchNumber, total: totalBatches }, 'Embedding batch');
    
    const texts = batch.map(c => c.content);
    const embeddings = await embedBatchWithRetry(texts);
    
    for (let j = 0; j < batch.length; j++) {
      embeddedChunks.push({
        ...batch[j],
        embedding: embeddings[j],
      });
    }
    
    onProgress?.(i + batch.length, chunks.length);
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < chunks.length) {
      await sleep(100);
    }
  }
  
  logger.info({ embedded: embeddedChunks.length }, 'Embedding complete');
  return embeddedChunks;
}
