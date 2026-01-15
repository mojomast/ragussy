/**
 * Forum Ingestion Module
 * 
 * Dedicated ingestion mode for threaded forum discussions.
 * Treats each post as the primary ingestion unit (utterance model).
 * 
 * Key features:
 * - Post-level chunking with identity preservation
 * - Rich metadata for conversational retrieval
 * - Deterministic IDs for idempotent ingestion
 * - Forum-aware retrieval with thread grouping
 * - Runtime configuration via .env
 */

// Types
export type {
  ForumPost,
  ForumThread,
  ForumChunk,
  ForumChunkMetadata,
  EmbeddedForumChunk,
  ForumIngestionConfig,
  ForumRetrievalConfig,
  ForumIngestionReport,
  QuotedContent,
  ThreadStats,
} from './types.js';

export {
  DEFAULT_FORUM_CONFIG,
  DEFAULT_FORUM_RETRIEVAL_CONFIG,
} from './types.js';

// Reader
export {
  parseForumThreadFile,
  readForumThreadsFromDirectory,
  readAllForumThreads,
  extractAllPosts,
  filterSubstantivePosts,
  filterChangedPosts,
  groupPostsByThread,
} from './forum-reader.js';

// Chunker
export {
  chunkForumPost,
  chunkQuotedContent,
  chunkForumThread,
  countTokens,
} from './forum-chunker.js';

// Pipeline
export {
  ForumIngestionPipeline,
  runForumPipeline,
} from './forum-pipeline.js';

// Retrieval
export {
  searchForumPosts,
  formatForumResultsForContext,
  summarizeViewpoints,
  type ForumSearchResult,
  type GroupedForumResults,
  type ForumRetrievalResult,
} from './forum-retrieval.js';

// Configuration
export {
  getForumIngestionConfig,
  getForumRetrievalConfig,
  isForumModeEnabled,
  getAllForumConfig,
  generateForumEnvExample,
  FORUM_ENV_VARS,
} from './forum-config.js';
