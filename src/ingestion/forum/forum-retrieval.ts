/**
 * Forum-Aware Retrieval
 * 
 * Retrieval behavior for forum discussions:
 * - Posts may disagree
 * - Advice may change over time
 * - No single post is authoritative
 * 
 * Groups results by thread, surfaces consensus and disagreement,
 * and references users and timeframes.
 */

import { logger } from '../../config/index.js';
import { searchVectors, type SearchResult } from '../../services/qdrant.js';
import { embedText } from '../../services/llm.js';
import type { ForumRetrievalConfig } from './types.js';
import { DEFAULT_FORUM_RETRIEVAL_CONFIG } from './types.js';

export interface ForumSearchResult {
  postId: string;
  threadId: string;
  username: string;
  date: string;
  threadTitle: string;
  forumCategory: string;
  content: string;
  anchor: string;
  score: number;
  keywords: string[];
  mentions: string[];
  images?: string[];
  subChunkIndex: number;
}

export interface GroupedForumResults {
  threadId: string;
  threadTitle: string;
  forumCategory: string;
  posts: ForumSearchResult[];
  dateRange: {
    earliest: string;
    latest: string;
  };
  uniqueUsers: string[];
  avgScore: number;
}

export interface ForumRetrievalResult {
  query: string;
  totalResults: number;
  threads: GroupedForumResults[];
  ungroupedResults?: ForumSearchResult[];
  metadata: {
    retrievalCount: number;
    groupedByThread: boolean;
    timeDecayApplied: boolean;
  };
}

/**
 * Apply time decay weighting to scores.
 * More recent posts get higher scores.
 */
function applyTimeDecay(
  results: ForumSearchResult[],
  halfLifeDays: number = 365
): ForumSearchResult[] {
  const now = Date.now();
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  
  return results.map(result => {
    const postDate = new Date(result.date).getTime();
    const ageMs = now - postDate;
    
    // Exponential decay: score * 0.5^(age/halfLife)
    const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
    
    return {
      ...result,
      score: result.score * (0.5 + 0.5 * decayFactor), // Blend original and decayed
    };
  });
}

/**
 * Group search results by thread.
 */
function groupByThread(
  results: ForumSearchResult[],
  maxPostsPerThread: number
): GroupedForumResults[] {
  const threadMap = new Map<string, ForumSearchResult[]>();
  
  for (const result of results) {
    const existing = threadMap.get(result.threadId) || [];
    existing.push(result);
    threadMap.set(result.threadId, existing);
  }
  
  const grouped: GroupedForumResults[] = [];
  
  for (const [threadId, posts] of threadMap) {
    // Sort by score within thread
    posts.sort((a, b) => b.score - a.score);
    
    // Limit posts per thread
    const limitedPosts = posts.slice(0, maxPostsPerThread);
    
    // Calculate metadata
    const dates = limitedPosts.map(p => new Date(p.date).getTime());
    const users = [...new Set(limitedPosts.map(p => p.username))];
    const avgScore = limitedPosts.reduce((sum, p) => sum + p.score, 0) / limitedPosts.length;
    
    grouped.push({
      threadId,
      threadTitle: limitedPosts[0].threadTitle,
      forumCategory: limitedPosts[0].forumCategory,
      posts: limitedPosts,
      dateRange: {
        earliest: new Date(Math.min(...dates)).toISOString(),
        latest: new Date(Math.max(...dates)).toISOString(),
      },
      uniqueUsers: users,
      avgScore,
    });
  }
  
  // Sort threads by average score
  grouped.sort((a, b) => b.avgScore - a.avgScore);
  
  return grouped;
}

/**
 * Search forum posts with forum-aware retrieval.
 */
export async function searchForumPosts(
  query: string,
  config: Partial<ForumRetrievalConfig> = {}
): Promise<ForumRetrievalResult> {
  const cfg: ForumRetrievalConfig = {
    ...DEFAULT_FORUM_RETRIEVAL_CONFIG,
    ...config,
  };
  
  logger.debug({
    query,
    config: cfg,
  }, 'Searching forum posts');
  
  // Embed query
  const queryEmbedding = await embedText(query);
  
  // Search with forum filter
  const searchResults = await searchVectors(queryEmbedding, cfg.retrievalCount, {
    must: [
      { key: 'docType', match: { value: 'forum_post' } },
    ],
  });
  
  // Convert to forum results
  let forumResults: ForumSearchResult[] = searchResults.map(result => ({
    postId: result.payload?.postId as string || '',
    threadId: result.payload?.threadId as string || '',
    username: result.payload?.username as string || '',
    date: result.payload?.date as string || '',
    threadTitle: result.payload?.threadTitle as string || '',
    forumCategory: result.payload?.forumCategory as string || '',
    content: result.payload?.content as string || '',
    anchor: result.payload?.anchor as string || '',
    score: result.score,
    keywords: (result.payload?.keywords as string[]) || [],
    mentions: (result.payload?.mentions as string[]) || [],
    images: (result.payload?.images as string[]) || undefined,
    subChunkIndex: result.payload?.subChunkIndex as number || 0,
  }));
  
  // Apply time decay if configured
  if (cfg.timeDecayWeighting && cfg.timeDecayHalfLifeDays) {
    forumResults = applyTimeDecay(forumResults, cfg.timeDecayHalfLifeDays);
    // Re-sort after decay
    forumResults.sort((a, b) => b.score - a.score);
  }
  
  // Group by thread if configured
  let threads: GroupedForumResults[] = [];
  let ungroupedResults: ForumSearchResult[] | undefined;
  
  if (cfg.groupByThreadOnRetrieval) {
    threads = groupByThread(forumResults, cfg.maxPostsPerThreadInContext);
  } else {
    ungroupedResults = forumResults;
  }
  
  logger.info({
    query,
    totalResults: forumResults.length,
    threads: threads.length,
    groupedByThread: cfg.groupByThreadOnRetrieval,
  }, 'Forum search complete');
  
  return {
    query,
    totalResults: forumResults.length,
    threads,
    ungroupedResults,
    metadata: {
      retrievalCount: cfg.retrievalCount,
      groupedByThread: cfg.groupByThreadOnRetrieval,
      timeDecayApplied: cfg.timeDecayWeighting,
    },
  };
}

/**
 * Format forum results for LLM context.
 * Uses "users discussed" framing, not "the forum states".
 */
export function formatForumResultsForContext(
  results: ForumRetrievalResult
): string {
  const lines: string[] = [];
  
  lines.push('## Forum Discussion Context\n');
  lines.push('The following are excerpts from forum discussions. Note that:');
  lines.push('- Users may disagree with each other');
  lines.push('- Advice may have changed over time');
  lines.push('- No single post should be treated as authoritative\n');
  
  if (results.threads.length > 0) {
    for (const thread of results.threads) {
      lines.push(`### Thread: ${thread.threadTitle}`);
      lines.push(`Category: ${thread.forumCategory}`);
      lines.push(`Date range: ${formatDateRange(thread.dateRange)}`);
      lines.push(`Participants: ${thread.uniqueUsers.slice(0, 5).join(', ')}${thread.uniqueUsers.length > 5 ? ` and ${thread.uniqueUsers.length - 5} others` : ''}\n`);
      
      for (const post of thread.posts) {
        const date = new Date(post.date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        
        lines.push(`**${post.username}** (${date}):`);
        lines.push(post.content);
        lines.push('');
      }
      
      lines.push('---\n');
    }
  } else if (results.ungroupedResults) {
    for (const post of results.ungroupedResults) {
      const date = new Date(post.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      
      lines.push(`**${post.username}** in "${post.threadTitle}" (${date}):`);
      lines.push(post.content);
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

function formatDateRange(range: { earliest: string; latest: string }): string {
  const earliest = new Date(range.earliest);
  const latest = new Date(range.latest);
  
  const formatDate = (d: Date) => d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
  });
  
  if (earliest.getTime() === latest.getTime()) {
    return formatDate(earliest);
  }
  
  return `${formatDate(earliest)} - ${formatDate(latest)}`;
}

/**
 * Build a summary of viewpoints from forum results.
 * Useful for surfacing consensus and disagreement.
 */
export function summarizeViewpoints(
  results: ForumRetrievalResult
): {
  consensus: string[];
  disagreements: string[];
  timeline: Array<{ date: string; summary: string }>;
} {
  // This would ideally use an LLM to analyze the results
  // For now, return a structure that can be populated
  return {
    consensus: [],
    disagreements: [],
    timeline: [],
  };
}
