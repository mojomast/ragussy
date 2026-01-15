/**
 * Forum Data Reader
 * 
 * Reads forum thread JSON files and extracts posts for ingestion.
 * Supports both single thread files and directories of threads.
 */

import fs from 'fs/promises';
import path from 'path';
import { logger, getDocsPath } from '../../config/index.js';
import type { ForumThread, ForumPost } from './types.js';

const FORUM_FILE_PATTERN = /^thread_\d+\.json$/;

/**
 * Check if a file is a forum thread JSON file.
 */
function isForumThreadFile(filename: string): boolean {
  return FORUM_FILE_PATTERN.test(filename) || filename.endsWith('.json');
}

/**
 * Parse a forum thread JSON file.
 */
export async function parseForumThreadFile(filePath: string): Promise<ForumThread | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as ForumThread;
    
    // Validate required fields
    if (!data.threadId || !data.posts || !Array.isArray(data.posts)) {
      logger.warn({ filePath }, 'Invalid forum thread file: missing threadId or posts');
      return null;
    }
    
    logger.debug({
      filePath,
      threadId: data.threadId,
      postsCount: data.posts.length,
    }, 'Parsed forum thread file');
    
    return data;
  } catch (error) {
    logger.error({ error, filePath }, 'Failed to parse forum thread file');
    return null;
  }
}

/**
 * Read all forum thread files from a directory.
 */
export async function readForumThreadsFromDirectory(dirPath: string): Promise<ForumThread[]> {
  const threads: ForumThread[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    const results = await Promise.all(entries.map(async (entry) => {
      if (entry.isFile() && isForumThreadFile(entry.name)) {
        const filePath = path.join(dirPath, entry.name);
        const thread = await parseForumThreadFile(filePath);
        return thread ? [thread] : [];
      } else if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subDirPath = path.join(dirPath, entry.name);
        return readForumThreadsFromDirectory(subDirPath);
      }
      return [];
    }));

    for (const result of results) {
      threads.push(...result);
    }
  } catch (error) {
    logger.error({ error, dirPath }, 'Failed to read forum threads directory');
  }
  
  logger.info({
    directory: dirPath,
    threadsFound: threads.length,
    totalPosts: threads.reduce((sum, t) => sum + t.posts.length, 0),
  }, 'Read forum threads from directory');
  
  return threads;
}

/**
 * Read forum threads from the default docs path.
 */
export async function readAllForumThreads(): Promise<ForumThread[]> {
  const docsPath = getDocsPath();
  return readForumThreadsFromDirectory(docsPath);
}

/**
 * Extract all posts from multiple threads.
 */
export function extractAllPosts(threads: ForumThread[]): ForumPost[] {
  const posts: ForumPost[] = [];
  
  for (const thread of threads) {
    for (const post of thread.posts) {
      // Ensure post has all required fields from thread context
      const enrichedPost: ForumPost = {
        ...post,
        threadId: post.threadId || thread.threadId,
        threadTitle: post.threadTitle || thread.threadTitle,
        forumCategory: post.forumCategory || thread.forumCategory,
        forumPath: post.forumPath || thread.forumPath,
      };
      posts.push(enrichedPost);
    }
  }
  
  return posts;
}

/**
 * Filter posts by substantive content.
 */
export function filterSubstantivePosts(posts: ForumPost[]): ForumPost[] {
  return posts.filter(post => {
    // Skip non-substantive posts
    if (post.isSubstantive === false) return false;
    
    // Skip empty content
    if (!post.content || post.content.trim().length === 0) return false;
    
    // Skip very short posts (likely just reactions)
    if (post.contentLength < 10) return false;
    
    return true;
  });
}

/**
 * Get posts that have changed since last ingestion.
 * Uses fingerprint comparison.
 */
export function filterChangedPosts(
  posts: ForumPost[],
  previousFingerprints: Map<string, string>
): { changed: ForumPost[]; unchanged: ForumPost[] } {
  const changed: ForumPost[] = [];
  const unchanged: ForumPost[] = [];
  
  for (const post of posts) {
    const key = `${post.threadId}:${post.postId}`;
    const previousFingerprint = previousFingerprints.get(key);
    
    if (previousFingerprint && previousFingerprint === post.fingerprint) {
      unchanged.push(post);
    } else {
      changed.push(post);
    }
  }
  
  logger.info({
    total: posts.length,
    changed: changed.length,
    unchanged: unchanged.length,
  }, 'Filtered posts by fingerprint');
  
  return { changed, unchanged };
}

/**
 * Group posts by thread for retrieval context.
 */
export function groupPostsByThread(posts: ForumPost[]): Map<string, ForumPost[]> {
  const grouped = new Map<string, ForumPost[]>();
  
  for (const post of posts) {
    const existing = grouped.get(post.threadId) || [];
    existing.push(post);
    grouped.set(post.threadId, existing);
  }
  
  // Sort posts within each thread by date
  for (const [threadId, threadPosts] of grouped) {
    threadPosts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  
  return grouped;
}
