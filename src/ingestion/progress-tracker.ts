import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/index.js';

const PROGRESS_FILE = process.env.INGESTION_PROGRESS_PATH || './data/ingestion-progress.json';

// Batched write configuration
const BATCH_INTERVAL_MS = 2000; // Flush every 2 seconds
const BATCH_SIZE_THRESHOLD = 50; // Or after 50 updates

export interface ChunkProgress {
  file: string;
  chunkIndex: number;
  chunkId: string;
  status: 'pending' | 'embedded' | 'upserted' | 'failed';
  error?: string;
  timestamp: string;
}

export interface IngestionProgress {
  sessionId: string;
  startedAt: string;
  lastUpdatedAt: string;
  totalFiles: number;
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  currentFile: string | null;
  currentChunkIndex: number;
  files: Record<string, {
    totalChunks: number;
    processedChunks: number;
    lastChunkIndex: number;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
  }>;
  failedItems: Array<{
    file: string;
    chunkIndex: number;
    chunkId: string;
    error: string;
    timestamp: string;
  }>;
}

// Batched write state
let pendingWrites = 0;
let flushTimer: NodeJS.Timeout | null = null;
let lastProgress: IngestionProgress | null = null;
let writePromise: Promise<void> | null = null;

async function ensureDataDir(): Promise<void> {
  const dir = path.dirname(PROGRESS_FILE);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Load existing progress from disk.
 */
export async function loadProgress(): Promise<IngestionProgress | null> {
  try {
    await ensureDataDir();
    const data = await fs.readFile(PROGRESS_FILE, 'utf-8');
    return JSON.parse(data) as IngestionProgress;
  } catch (error) {
    return null;
  }
}

/**
 * Internal: Actually write progress to disk.
 */
async function writeProgressToDisk(progress: IngestionProgress): Promise<void> {
  await ensureDataDir();
  progress.lastUpdatedAt = new Date().toISOString();
  const tempFile = PROGRESS_FILE + '.tmp';
  await fs.writeFile(tempFile, JSON.stringify(progress, null, 2), 'utf-8');
  await fs.rename(tempFile, PROGRESS_FILE);
}

/**
 * Schedule a batched write. Non-blocking.
 */
function scheduleBatchedWrite(progress: IngestionProgress): void {
  lastProgress = progress;
  pendingWrites++;
  
  // Flush immediately if threshold reached
  if (pendingWrites >= BATCH_SIZE_THRESHOLD) {
    flushProgressSync(progress);
    return;
  }
  
  // Schedule timer-based flush if not already scheduled
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushProgressSync(lastProgress!);
    }, BATCH_INTERVAL_MS);
  }
}

/**
 * Synchronously trigger a flush (non-blocking, returns immediately).
 */
function flushProgressSync(progress: IngestionProgress): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  
  if (pendingWrites === 0) return;
  
  pendingWrites = 0;
  
  // Fire and forget, but track promise for final flush
  writePromise = writeProgressToDisk(progress).catch(err => {
    logger.error({ error: err }, 'Failed to write progress');
  });
}

/**
 * Flush any pending progress writes. Awaitable.
 */
export async function flushProgress(progress: IngestionProgress | null): Promise<void> {
  if (!progress) return;
  
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  
  if (pendingWrites > 0 || writePromise) {
    pendingWrites = 0;
    await writeProgressToDisk(progress);
    if (writePromise) {
      await writePromise;
      writePromise = null;
    }
  }
}

/**
 * Save progress immediately (for initial save).
 */
export async function saveProgress(progress: IngestionProgress): Promise<void> {
  await writeProgressToDisk(progress);
}

/**
 * Save progress with batching (for high-frequency updates).
 */
export async function saveProgressBatched(progress: IngestionProgress): Promise<void> {
  scheduleBatchedWrite(progress);
}

/**
 * Create a new ingestion progress session.
 */
export function createProgress(
  sessionId: string,
  totalFiles: number,
  totalChunks: number
): IngestionProgress {
  return {
    sessionId,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    totalFiles,
    totalChunks,
    processedChunks: 0,
    failedChunks: 0,
    currentFile: null,
    currentChunkIndex: 0,
    files: {},
    failedItems: [],
  };
}

/**
 * Initialize file tracking in progress.
 */
export function initFileProgress(
  progress: IngestionProgress,
  filePath: string,
  totalChunks: number
): void {
  progress.files[filePath] = {
    totalChunks,
    processedChunks: 0,
    lastChunkIndex: -1,
    status: 'pending',
  };
}

/**
 * Mark a chunk as successfully processed (batched, non-blocking).
 */
export function markChunkProcessedBatched(
  progress: IngestionProgress,
  filePath: string,
  chunkIndex: number
): void {
  progress.processedChunks++;
  progress.currentFile = filePath;
  progress.currentChunkIndex = chunkIndex;
  
  if (progress.files[filePath]) {
    progress.files[filePath].processedChunks++;
    progress.files[filePath].lastChunkIndex = chunkIndex;
    progress.files[filePath].status = 'in_progress';
  }
  
  scheduleBatchedWrite(progress);
}

/**
 * Mark a chunk as successfully processed (immediate write - legacy).
 */
export async function markChunkProcessed(
  progress: IngestionProgress,
  filePath: string,
  chunkIndex: number
): Promise<void> {
  markChunkProcessedBatched(progress, filePath, chunkIndex);
  await flushProgress(progress);
}

/**
 * Mark a chunk as failed (batched, non-blocking).
 */
export function markChunkFailedBatched(
  progress: IngestionProgress,
  filePath: string,
  chunkIndex: number,
  chunkId: string,
  error: string
): void {
  progress.failedChunks++;
  progress.currentFile = filePath;
  progress.currentChunkIndex = chunkIndex;
  
  progress.failedItems.push({
    file: filePath,
    chunkIndex,
    chunkId,
    error,
    timestamp: new Date().toISOString(),
  });
  
  if (progress.files[filePath]) {
    progress.files[filePath].lastChunkIndex = chunkIndex;
  }
  
  scheduleBatchedWrite(progress);
  
  logger.error({
    file: filePath,
    chunkIndex,
    chunkId,
    error,
  }, 'Chunk processing failed');
}

/**
 * Mark a chunk as failed (immediate write - legacy).
 */
export async function markChunkFailed(
  progress: IngestionProgress,
  filePath: string,
  chunkIndex: number,
  chunkId: string,
  error: string
): Promise<void> {
  markChunkFailedBatched(progress, filePath, chunkIndex, chunkId, error);
  await flushProgress(progress);
}

/**
 * Mark a file as completed.
 */
export async function markFileCompleted(
  progress: IngestionProgress,
  filePath: string
): Promise<void> {
  if (progress.files[filePath]) {
    progress.files[filePath].status = 'completed';
  }
  scheduleBatchedWrite(progress);
}

/**
 * Mark a file as failed.
 */
export async function markFileFailed(
  progress: IngestionProgress,
  filePath: string
): Promise<void> {
  if (progress.files[filePath]) {
    progress.files[filePath].status = 'failed';
  }
  scheduleBatchedWrite(progress);
}

/**
 * Check if a specific chunk should be skipped (already processed).
 */
export function shouldSkipChunk(
  progress: IngestionProgress | null,
  filePath: string,
  chunkIndex: number
): boolean {
  if (!progress) return false;
  
  const fileProgress = progress.files[filePath];
  if (!fileProgress) return false;
  
  return chunkIndex <= fileProgress.lastChunkIndex;
}

/**
 * Get the starting chunk index for a file (for resumption).
 */
export function getResumeChunkIndex(
  progress: IngestionProgress | null,
  filePath: string
): number {
  if (!progress) return 0;
  
  const fileProgress = progress.files[filePath];
  if (!fileProgress) return 0;
  
  return fileProgress.lastChunkIndex + 1;
}

/**
 * Clear progress file (for fresh start).
 */
export async function clearProgress(): Promise<void> {
  // Clear any pending writes
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingWrites = 0;
  lastProgress = null;
  writePromise = null;
  
  try {
    await fs.unlink(PROGRESS_FILE);
    logger.info('Cleared ingestion progress');
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
  return `ingest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
