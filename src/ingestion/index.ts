export { readAllDocs, readDocFile, walkDocs, type DocFile } from './document-reader.js';
export {
  chunkDocument,
  chunkDocuments,
  countTokens,
  validateChunkTokens,
  type DocChunk,
  type ChunkerConfig,
} from './chunker.js';
export {
  embedSingleChunk,
  embedChunks,
  type EmbeddedChunk,
  type EmbedResult,
} from './embedder.js';
export {
  ingestIncremental,
  ingestFull,
  ingestFullResumable,
  ingestFullPartial,
  ingestSelected,
  getRuntimeConfig,
  getChunkConfig,
  type IngestResult,
  type IngestionReport,
  type PartialIngestResult,
  type SelectiveIngestOptions,
} from './ingest.js';
export {
  IngestionPipeline,
  runPipeline,
  type PipelineConfig,
  type PipelineReport,
} from './pipeline.js';
export {
  initStateStore,
  getFileState,
  getAllFileStates,
  updateFileState,
  updateFileStateBatched,
  deleteFileState,
  clearAllState,
  closeStateStore,
  flushStateStore,
  type FileState,
} from './state-store.js';
export {
  loadProgress,
  saveProgress,
  saveProgressBatched,
  clearProgress,
  flushProgress,
  markChunkProcessedBatched,
  markChunkFailedBatched,
  type IngestionProgress,
} from './progress-tracker.js';

// Forum Ingestion Module
export * from './forum/index.js';
