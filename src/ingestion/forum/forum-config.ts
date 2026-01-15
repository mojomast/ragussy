/**
 * Forum Configuration
 * 
 * Runtime configuration for forum ingestion mode.
 * Reads from .env file to support frontend changes without redeployment.
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../config/index.js';
import type { ForumIngestionConfig, ForumRetrievalConfig } from './types.js';
import { DEFAULT_FORUM_CONFIG, DEFAULT_FORUM_RETRIEVAL_CONFIG } from './types.js';

const ENV_PATH = path.join(process.cwd(), '.env');

// Cache for dynamic env values
let envCache: Record<string, string> | null = null;
let envCacheTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Parse .env file for runtime configuration.
 */
async function parseEnvFile(): Promise<Record<string, string>> {
  const now = Date.now();
  if (envCache && (now - envCacheTime) < CACHE_TTL_MS) {
    return envCache;
  }

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
    
    envCache = envVars;
    envCacheTime = now;
    return envVars;
  } catch {
    return {};
  }
}

/**
 * Get forum ingestion configuration from environment.
 * Supports runtime changes via .env file.
 */
export async function getForumIngestionConfig(): Promise<ForumIngestionConfig> {
  const env = await parseEnvFile();
  
  return {
    // Chunking
    maxTokens: parseInt(env.FORUM_MAX_TOKENS || '') || DEFAULT_FORUM_CONFIG.maxTokens,
    overlapTokens: parseInt(env.FORUM_OVERLAP_TOKENS || '') || DEFAULT_FORUM_CONFIG.overlapTokens,
    absoluteMaxTokens: parseInt(env.FORUM_ABSOLUTE_MAX_TOKENS || '') || DEFAULT_FORUM_CONFIG.absoluteMaxTokens,
    embeddingModel: env.FORUM_EMBEDDING_MODEL || env.EMBED_MODEL || DEFAULT_FORUM_CONFIG.embeddingModel,
    
    // Forum-specific
    embedQuotedContent: env.FORUM_EMBED_QUOTED_CONTENT === 'true',
    quotedContentNamespace: env.FORUM_QUOTED_NAMESPACE || undefined,
    
    // Threading
    embeddingThreads: parseInt(env.FORUM_EMBEDDING_THREADS || env.EMBEDDING_THREADS || '') || DEFAULT_FORUM_CONFIG.embeddingThreads,
    upsertThreads: parseInt(env.FORUM_UPSERT_THREADS || env.UPSERT_THREADS || '') || DEFAULT_FORUM_CONFIG.upsertThreads,
    
    // Behavior
    skipUnchangedPosts: env.FORUM_SKIP_UNCHANGED !== 'false', // Default true
    resume: env.FORUM_RESUME === 'true',
  };
}

/**
 * Get forum retrieval configuration from environment.
 */
export async function getForumRetrievalConfig(): Promise<ForumRetrievalConfig> {
  const env = await parseEnvFile();
  
  return {
    groupByThreadOnRetrieval: env.FORUM_GROUP_BY_THREAD !== 'false', // Default true
    timeDecayWeighting: env.FORUM_TIME_DECAY === 'true',
    timeDecayHalfLifeDays: parseInt(env.FORUM_TIME_DECAY_HALF_LIFE || '') || DEFAULT_FORUM_RETRIEVAL_CONFIG.timeDecayHalfLifeDays,
    maxPostsPerThreadInContext: parseInt(env.FORUM_MAX_POSTS_PER_THREAD || '') || DEFAULT_FORUM_RETRIEVAL_CONFIG.maxPostsPerThreadInContext,
    retrievalCount: parseInt(env.FORUM_RETRIEVAL_COUNT || '') || DEFAULT_FORUM_RETRIEVAL_CONFIG.retrievalCount,
  };
}

/**
 * Check if forum mode is enabled.
 */
export async function isForumModeEnabled(): Promise<boolean> {
  const env = await parseEnvFile();
  return env.FORUM_MODE === 'true';
}

/**
 * Get all forum configuration for display/debugging.
 */
export async function getAllForumConfig(): Promise<{
  enabled: boolean;
  ingestion: ForumIngestionConfig;
  retrieval: ForumRetrievalConfig;
}> {
  const [enabled, ingestion, retrieval] = await Promise.all([
    isForumModeEnabled(),
    getForumIngestionConfig(),
    getForumRetrievalConfig(),
  ]);
  
  return { enabled, ingestion, retrieval };
}

/**
 * Environment variable documentation for forum mode.
 */
export const FORUM_ENV_VARS = {
  // Mode toggle
  FORUM_MODE: 'Enable forum ingestion mode (true/false)',
  
  // Ingestion settings
  FORUM_MAX_TOKENS: 'Max tokens per chunk (default: 800)',
  FORUM_OVERLAP_TOKENS: 'Overlap tokens between chunks (default: 120)',
  FORUM_ABSOLUTE_MAX_TOKENS: 'Absolute max tokens, never exceed (default: 1024)',
  FORUM_EMBEDDING_MODEL: 'Embedding model for forum content (default: baai/bge-m3)',
  FORUM_EMBED_QUOTED_CONTENT: 'Embed quoted content separately (default: false)',
  FORUM_QUOTED_NAMESPACE: 'Separate namespace for quoted content (optional)',
  FORUM_EMBEDDING_THREADS: 'Concurrent embedding workers (default: 6)',
  FORUM_UPSERT_THREADS: 'Concurrent upsert workers (default: 4)',
  FORUM_SKIP_UNCHANGED: 'Skip unchanged posts via fingerprint (default: true)',
  FORUM_RESUME: 'Resume from last checkpoint (default: false)',
  
  // Retrieval settings
  FORUM_GROUP_BY_THREAD: 'Group results by thread (default: true)',
  FORUM_TIME_DECAY: 'Apply time decay to scores (default: false)',
  FORUM_TIME_DECAY_HALF_LIFE: 'Days until relevance halves (default: 365)',
  FORUM_MAX_POSTS_PER_THREAD: 'Max posts per thread in context (default: 10)',
  FORUM_RETRIEVAL_COUNT: 'Number of posts to retrieve (default: 30)',
};

/**
 * Generate example .env entries for forum mode.
 */
export function generateForumEnvExample(): string {
  return `
# ============================================================================
# Forum Ingestion Mode Configuration
# ============================================================================

# Enable forum mode
FORUM_MODE=true

# Ingestion Settings
FORUM_MAX_TOKENS=800
FORUM_OVERLAP_TOKENS=120
FORUM_ABSOLUTE_MAX_TOKENS=1024
FORUM_EMBEDDING_MODEL=baai/bge-m3
FORUM_EMBED_QUOTED_CONTENT=false
# FORUM_QUOTED_NAMESPACE=quoted_content
FORUM_EMBEDDING_THREADS=6
FORUM_UPSERT_THREADS=4
FORUM_SKIP_UNCHANGED=true
FORUM_RESUME=false

# Retrieval Settings
FORUM_GROUP_BY_THREAD=true
FORUM_TIME_DECAY=false
FORUM_TIME_DECAY_HALF_LIFE=365
FORUM_MAX_POSTS_PER_THREAD=10
FORUM_RETRIEVAL_COUNT=30
`.trim();
}
