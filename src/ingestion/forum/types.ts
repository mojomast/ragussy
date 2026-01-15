/**
 * Forum Ingestion Types
 * 
 * Defines the data structures for forum post ingestion.
 * Each post is treated as the primary ingestion unit (utterance model).
 */

export interface ForumPost {
  postId: string;
  threadId: string;
  page: number;
  username: string;
  userId: string;
  date: string;
  rawDate?: string;
  content: string;           // Original content (quotes removed)
  contentFull: string;       // Full content including quotes
  quotedContent: QuotedContent[];
  images: string[];
  links: string[];
  mentions: string[];
  keywords: string[];
  threadTitle: string;
  forumCategory: string;
  forumPath: string[];
  anchor: string;
  fingerprint: string;       // For change detection
  isSubstantive: boolean;
  hasImages: boolean;
  hasLinks: boolean;
  contentLength: number;
}

export interface QuotedContent {
  user?: string;
  text: string;
}

export interface ForumThread {
  threadId: string;
  threadUrl: string;
  threadTitle: string;
  forumCategory: string;
  forumPath: string[];
  extractedAt: string;
  extractorVersion?: string;
  stats: ThreadStats;
  participants: string[];
  keywords: string[];
  posts: ForumPost[];
}

export interface ThreadStats {
  totalPosts: number;
  substantivePosts: number;
  uniqueUsers: number;
  totalImages: number;
  totalLinks: number;
  dateRange: {
    first: string;
    last: string;
  };
}

/**
 * Forum chunk - represents a single embeddable unit from a post.
 * One post may produce multiple chunks if it exceeds token limits.
 */
export interface ForumChunk {
  id: string;                 // Deterministic: hash(threadId + postId + subChunkIndex + model)
  content: string;            // The text to embed
  tokenCount: number;
  metadata: ForumChunkMetadata;
}

export interface ForumChunkMetadata {
  // Identity
  threadId: string;
  postId: string;
  subChunkIndex: number;
  
  // Author info
  username: string;
  userId: string;
  date: string;               // ISO format
  
  // Thread context
  threadTitle: string;
  forumCategory: string;
  forumPath: string[];
  page: number;
  anchor: string;
  
  // Content metadata
  keywords: string[];
  mentions: string[];
  hasLinks: boolean;
  hasImages: boolean;
  images?: string[];          // Image URLs if present
  contentLength: number;
  
  // For change detection / idempotency
  fingerprint: string;
  embeddingModel: string;
  
  // Chunk type
  chunkType: 'original' | 'quoted';
}

/**
 * Embedded forum chunk ready for vector storage.
 */
export interface EmbeddedForumChunk extends ForumChunk {
  embedding: number[];
}

/**
 * Forum ingestion configuration.
 */
export interface ForumIngestionConfig {
  // Chunking
  maxTokens: number;
  overlapTokens: number;
  absoluteMaxTokens: number;
  embeddingModel: string;
  
  // Forum-specific options
  embedQuotedContent: boolean;      // Default: false
  quotedContentNamespace?: string;  // Separate namespace for quoted content
  
  // Threading
  embeddingThreads: number;
  upsertThreads: number;
  
  // Behavior
  skipUnchangedPosts: boolean;      // Use fingerprint comparison
  resume: boolean;
  
  // Callbacks
  onProgress?: (current: number, total: number, threadId: string, postId: string) => void;
  onPostComplete?: (postId: string, success: boolean, error?: string) => void;
}

export const DEFAULT_FORUM_CONFIG: ForumIngestionConfig = {
  maxTokens: 800,
  overlapTokens: 120,
  absoluteMaxTokens: 1024,
  embeddingModel: 'baai/bge-m3',
  embedQuotedContent: false,
  embeddingThreads: 6,
  upsertThreads: 4,
  skipUnchangedPosts: true,
  resume: false,
};

/**
 * Forum retrieval configuration (frontend-exposed).
 */
export interface ForumRetrievalConfig {
  groupByThreadOnRetrieval: boolean;  // Default: true
  timeDecayWeighting: boolean;        // Default: false
  timeDecayHalfLifeDays?: number;     // Days until relevance halves
  maxPostsPerThreadInContext: number; // Default: 10
  retrievalCount: number;             // Default: 30
}

export const DEFAULT_FORUM_RETRIEVAL_CONFIG: ForumRetrievalConfig = {
  groupByThreadOnRetrieval: true,
  timeDecayWeighting: false,
  timeDecayHalfLifeDays: 365,
  maxPostsPerThreadInContext: 10,
  retrievalCount: 30,
};

/**
 * Forum ingestion report.
 */
export interface ForumIngestionReport {
  sessionId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  threadsProcessed: number;
  postsProcessed: number;
  chunksEmbedded: number;
  postsSkipped: number;       // Unchanged posts
  failedPosts: Array<{
    threadId: string;
    postId: string;
    reason: string;
  }>;
  diagnostics?: {
    peakEmbeddingInFlight: number;
    avgEmbeddingLatencyMs: number;
    rateLimitHits: number;
    vectorsPerSecond: number;
  };
}
