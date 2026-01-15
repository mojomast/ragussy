/**
 * Ingestion module - provides both legacy API and new pipeline API.
 * 
 * The new pipeline supports:
 * - Runtime configuration from frontend settings
 * - Multi-threaded processing with bounded worker pools
 * - Resumable ingestion with progress tracking
 * - Deterministic chunk IDs for idempotent retries
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger, env } from '../config/index.js';
import { readAllDocs, type DocFile } from './document-reader.js';
import { chunkDocument, countTokens, type DocChunk, type ChunkerConfig } from './chunker.js';
import { embedSingleChunk, type EmbeddedChunk } from './embedder.js';
import { runPipeline, type PipelineConfig, type PipelineReport } from './pipeline.js';
import {
  initStateStore,
  getFileState,
  getAllFileStates,
  updateFileState,
  deleteFileState,
  clearAllState,
  closeStateStore,
} from './state-store.js';
import {
  loadProgress,
  saveProgress,
  createProgress,
  initFileProgress,
  markChunkProcessed,
  markChunkFailed,
  markFileCompleted,
  clearProgress,
  generateSessionId,
  getResumeChunkIndex,
  type IngestionProgress,
} from './progress-tracker.js';
import {
  ensureCollection,
  upsertVectors,
  deleteVectorsByFilter,
  getCollectionInfo,
  getQdrantClient,
} from '../services/qdrant.js';

const ENV_PATH = path.join(process.cwd(), '.env');

/**
 * Parse .env file to get runtime configuration.
 * This allows frontend settings to take effect without server restart.
 */
async function parseEnvFile(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(ENV_PATH, 'utf-8');
    const envVars: Record<string, string> = {};
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        envVars[key] = value;
      }
    }
    
    return envVars;
  } catch {
    return {};
  }
}

/**
 * Get runtime ingestion configuration from .env file.
 * Reads fresh values each time to support frontend changes.
 */
export async function getRuntimeConfig(): Promise<{
  maxChunkTokens: number;
  chunkOverlapTokens: number;
  absoluteMaxTokens: number;
  embeddingThreads: number;
  upsertThreads: number;
  failFastValidation: boolean;
  embeddingModel: string;
}> {
  const fileEnv = await parseEnvFile();
  
  return {
    maxChunkTokens: parseInt(fileEnv.CHUNK_MAX_TOKENS || String(env.CHUNK_MAX_TOKENS)) || 800,
    chunkOverlapTokens: parseInt(fileEnv.CHUNK_OVERLAP_TOKENS || String(env.CHUNK_OVERLAP_TOKENS)) || 120,
    absoluteMaxTokens: parseInt(fileEnv.ABSOLUTE_MAX_TOKENS || '1024'),
    embeddingThreads: parseInt(fileEnv.EMBEDDING_THREADS || '4'),
    upsertThreads: parseInt(fileEnv.UPSERT_THREADS || '2'),
    failFastValidation: fileEnv.FAIL_FAST_VALIDATION === 'true',
    embeddingModel: fileEnv.EMBED_MODEL || env.EMBED_MODEL || 'text-embedding-3-small',
  };
}

/**
 * Get chunking configuration (legacy compatibility).
 */
export async function getChunkConfig(): Promise<ChunkerConfig> {
  const runtime = await getRuntimeConfig();
  return {
    maxTokens: runtime.maxChunkTokens,
    overlapTokens: runtime.chunkOverlapTokens,
    absoluteMaxTokens: runtime.absoluteMaxTokens,
    embeddingModel: runtime.embeddingModel,
  };
}

function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface IngestResult {
  filesScanned: number;
  filesUpdated: number;
  filesDeleted: number;
  chunksUpserted: number;
  chunksDeleted: number;
  errors: string[];
}

export interface IngestionReport {
  sessionId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalFilesProcessed: number;
  totalChunksEmbedded: number;
  failedChunks: Array<{
    file: string;
    chunkIndex: number;
    reason: string;
  }>;
  summary: {
    success: boolean;
    filesScanned: number;
    filesUpdated: number;
    chunksUpserted: number;
    chunksDeleted: number;
    errorCount: number;
  };
}

/**
 * Upsert a single embedded chunk to the vector database.
 */
async function upsertSingleChunk(chunk: EmbeddedChunk): Promise<void> {
  await upsertVectors([{
    id: chunk.id,
    vector: chunk.embedding,
    payload: { ...chunk.metadata, content: chunk.content },
  }]);
}

/**
 * Production-grade full ingestion using the multi-threaded pipeline.
 * 
 * Features:
 * - Runtime configuration from frontend settings
 * - Multi-threaded embedding and upsert
 * - Resumable from last successful chunk
 * - Isolated failures with continuation
 */
export async function ingestFullResumable(
  options: { 
    resume?: boolean; 
    onProgress?: (current: number, total: number, file: string) => void 
  } = {}
): Promise<IngestionReport> {
  // Get runtime configuration
  const runtimeConfig = await getRuntimeConfig();
  
  logger.info({
    config: runtimeConfig,
    resume: options.resume,
  }, 'Starting full ingestion with runtime config');
  
  // Build pipeline config
  const pipelineConfig: Partial<PipelineConfig> = {
    maxChunkTokens: runtimeConfig.maxChunkTokens,
    chunkOverlapTokens: runtimeConfig.chunkOverlapTokens,
    absoluteMaxTokens: runtimeConfig.absoluteMaxTokens,
    embeddingModel: runtimeConfig.embeddingModel,
    embeddingThreads: runtimeConfig.embeddingThreads,
    upsertThreads: runtimeConfig.upsertThreads,
    failFastValidation: runtimeConfig.failFastValidation,
    resume: options.resume ?? false,
    onProgress: options.onProgress 
      ? (current, total, file, _stage) => options.onProgress!(current, total, file)
      : undefined,
  };
  
  // Run pipeline
  const pipelineReport = await runPipeline(pipelineConfig);
  
  // Convert to legacy report format
  return {
    sessionId: pipelineReport.sessionId,
    startedAt: pipelineReport.startedAt,
    completedAt: pipelineReport.completedAt,
    durationMs: pipelineReport.durationMs,
    totalFilesProcessed: pipelineReport.totalFilesProcessed,
    totalChunksEmbedded: pipelineReport.totalChunksEmbedded,
    failedChunks: pipelineReport.failedChunks.map(f => ({
      file: f.file,
      chunkIndex: f.chunkIndex,
      reason: f.reason,
    })),
    summary: {
      success: pipelineReport.summary.success,
      filesScanned: pipelineReport.summary.filesScanned,
      filesUpdated: pipelineReport.summary.filesUpdated,
      chunksUpserted: pipelineReport.summary.chunksUpserted,
      chunksDeleted: 0,
      errorCount: pipelineReport.summary.errorCount,
    },
  };
}

/**
 * Incremental ingestion - only process changed files.
 */
export async function ingestIncremental(): Promise<IngestResult> {
  const result: IngestResult = {
    filesScanned: 0,
    filesUpdated: 0,
    filesDeleted: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
    errors: [],
  };

  const chunkConfig = await getChunkConfig();

  try {
    await initStateStore();
    await ensureCollection();

    const docs = await readAllDocs();
    result.filesScanned = docs.length;

    const currentFilePaths = new Set(docs.map(d => d.filePath));
    const previousStates = await getAllFileStates();

    // Delete removed files
    for (const state of previousStates) {
      if (!currentFilePaths.has(state.filePath)) {
        logger.info({ file: state.filePath }, 'Deleting removed file from index');

        try {
          const chunkIds = await deleteFileState(state.filePath);
          await deleteVectorsByFilter({
            must: [{ key: 'source_file', match: { value: state.filePath } }],
          });
          result.filesDeleted++;
          result.chunksDeleted += chunkIds.length;
        } catch (error) {
          const msg = `Failed to delete ${state.filePath}: ${error}`;
          logger.error({ error, file: state.filePath }, 'Delete failed');
          result.errors.push(msg);
        }
      }
    }

    // Process changed/new files
    for (const doc of docs) {
      const contentHash = hashFileContent(doc.content);
      const state = await getFileState(doc.filePath);

      if (state && state.contentHash === contentHash) {
        logger.debug({ file: doc.filePath }, 'File unchanged, skipping');
        continue;
      }

      logger.info(
        { file: doc.filePath, isNew: !state },
        state ? 'File changed, re-indexing' : 'New file, indexing'
      );

      // Delete existing vectors
      if (state) {
        await deleteVectorsByFilter({
          must: [{ key: 'source_file', match: { value: doc.filePath } }],
        });
        result.chunksDeleted += state.chunkCount;
      }

      // Chunk with runtime config
      const chunks = chunkDocument(doc, chunkConfig);
      const chunkIds: string[] = [];

      // Process each chunk individually
      for (const chunk of chunks) {
        try {
          const embedResult = await embedSingleChunk(chunk);
          
          if (embedResult.success && embedResult.chunk) {
            await upsertSingleChunk(embedResult.chunk);
            chunkIds.push(chunk.id);
            result.chunksUpserted++;
          } else {
            result.errors.push(
              `Embed failed: ${doc.filePath} chunk ${chunk.metadata.chunk_index}: ${embedResult.error}`
            );
          }
        } catch (error) {
          const msg = `${doc.filePath} chunk ${chunk.metadata.chunk_index}: ${error}`;
          result.errors.push(msg);
        }
      }

      if (chunkIds.length > 0) {
        await updateFileState(doc.filePath, contentHash, chunkIds);
        result.filesUpdated++;
        logger.info({ file: doc.filePath, chunks: chunkIds.length }, 'File indexed');
      }
    }

    logger.info(result, 'Incremental ingestion complete');
    return result;
  } finally {
    await closeStateStore();
  }
}

/**
 * Full ingestion - rebuild entire index.
 */
export async function ingestFull(): Promise<IngestResult> {
  const report = await ingestFullResumable({ resume: false });
  
  return {
    filesScanned: report.totalFilesProcessed,
    filesUpdated: report.totalFilesProcessed,
    filesDeleted: 0,
    chunksUpserted: report.totalChunksEmbedded,
    chunksDeleted: 0,
    errors: report.failedChunks.map(f => `${f.file} chunk ${f.chunkIndex}: ${f.reason}`),
  };
}

// Legacy exports for backwards compatibility
export interface PartialIngestOptions {
  maxChunksPerBatch?: number;
  startIndex?: number;
}

export interface PartialIngestResult extends IngestResult {
  hasMore: boolean;
  nextStartIndex: number;
  processedChunks: number;
}

export async function ingestFullPartial(options: PartialIngestOptions = {}): Promise<PartialIngestResult> {
  const report = await ingestFullResumable({ resume: true });
  
  return {
    filesScanned: report.totalFilesProcessed,
    filesUpdated: report.totalFilesProcessed,
    filesDeleted: 0,
    chunksUpserted: report.totalChunksEmbedded,
    chunksDeleted: 0,
    errors: report.failedChunks.map(f => `${f.file} chunk ${f.chunkIndex}: ${f.reason}`),
    hasMore: false,
    nextStartIndex: 0,
    processedChunks: report.totalChunksEmbedded,
  };
}

export interface SelectiveIngestOptions {
  filePaths: string[];
}

export async function ingestSelected(options: SelectiveIngestOptions): Promise<IngestResult> {
  const { filePaths } = options;
  const chunkConfig = await getChunkConfig();

  const result: IngestResult = {
    filesScanned: filePaths.length,
    filesUpdated: 0,
    filesDeleted: 0,
    chunksUpserted: 0,
    chunksDeleted: 0,
    errors: [],
  };

  if (filePaths.length === 0) {
    logger.info('No files selected for ingestion');
    return result;
  }

  try {
    await initStateStore();
    await ensureCollection();

    const allDocs = await readAllDocs();
    const selectedDocs = allDocs.filter(doc => filePaths.includes(doc.filePath));

    logger.info({ requested: filePaths.length, found: selectedDocs.length }, 'Processing selected files');

    if (selectedDocs.length === 0) {
      result.errors.push('None of the selected files were found');
      return result;
    }

    for (const doc of selectedDocs) {
      // Delete existing vectors
      const oldState = await getFileState(doc.filePath);
      if (oldState) {
        await deleteVectorsByFilter({
          must: [{ key: 'source_file', match: { value: doc.filePath } }],
        });
        result.chunksDeleted += oldState.chunkCount;
      }

      // Chunk with runtime config
      const chunks = chunkDocument(doc, chunkConfig);
      const chunkIds: string[] = [];

      // Process each chunk individually
      for (const chunk of chunks) {
        try {
          const embedResult = await embedSingleChunk(chunk);
          
          if (embedResult.success && embedResult.chunk) {
            await upsertVectors([{
              id: embedResult.chunk.id,
              vector: embedResult.chunk.embedding,
              payload: { ...embedResult.chunk.metadata, content: embedResult.chunk.content },
            }]);
            chunkIds.push(chunk.id);
            result.chunksUpserted++;
          } else {
            result.errors.push(
              `Embed failed: ${doc.filePath} chunk ${chunk.metadata.chunk_index}: ${embedResult.error}`
            );
          }
        } catch (error) {
          result.errors.push(`${doc.filePath} chunk ${chunk.metadata.chunk_index}: ${error}`);
        }
      }

      if (chunkIds.length > 0) {
        const contentHash = hashFileContent(doc.content);
        await updateFileState(doc.filePath, contentHash, chunkIds);
        result.filesUpdated++;
        logger.info({ file: doc.filePath, chunks: chunkIds.length }, 'File indexed');
      }
    }

    logger.info(result, 'Selective ingestion complete');
    return result;
  } finally {
    await closeStateStore();
  }
}

// Re-export types and functions from chunker for convenience
export { countTokens } from './chunker.js';
export type { DocChunk, ChunkerConfig } from './chunker.js';
