/**
 * Forum-Specific Chunker
 * 
 * Treats each post as the primary ingestion unit.
 * If a post exceeds token limits, splits internally while preserving post identity.
 * Never merges unrelated posts into a single chunk.
 * 
 * Chunking hierarchy:
 * 1. Paragraph boundaries
 * 2. Sentence boundaries
 * 3. Token window with overlap
 * 
 * NEVER rejects a chunk due to size - always produces valid output.
 */

import { createHash } from 'crypto';
import { encoding_for_model, type Tiktoken } from 'tiktoken';
import { logger } from '../../config/index.js';
import type { ForumPost, ForumChunk, ForumChunkMetadata, ForumIngestionConfig } from './types.js';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = encoding_for_model('gpt-4');
  }
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  const enc = getEncoder();
  return enc.encode(text).length;
}

/**
 * Generate deterministic chunk ID.
 * hash(threadId + postId + subChunkIndex + embeddingModel)
 */
function generateForumChunkId(
  threadId: string,
  postId: string,
  subChunkIndex: number,
  embeddingModel: string
): string {
  const input = `forum::${threadId}::${postId}::${subChunkIndex}::${embeddingModel}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/**
 * Split text by paragraph boundaries.
 */
function splitByParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim());
}

/**
 * Split text by sentence boundaries.
 */
function splitBySentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (!sentences) return [text];
  return sentences.filter(s => s.trim());
}

/**
 * Split text by token window with overlap.
 * Last resort for text that can't be split by sentences.
 */
function splitByTokenWindow(
  text: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  
  let currentChunk: string[] = [];
  let currentTokens = 0;
  
  for (const word of words) {
    const wordTokens = countTokens(word + ' ');
    
    if (currentTokens + wordTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      
      // Calculate overlap
      const overlapWords: string[] = [];
      let overlapCount = 0;
      for (let i = currentChunk.length - 1; i >= 0 && overlapCount < overlapTokens; i--) {
        const wt = countTokens(currentChunk[i] + ' ');
        if (overlapCount + wt <= overlapTokens) {
          overlapWords.unshift(currentChunk[i]);
          overlapCount += wt;
        } else {
          break;
        }
      }
      
      currentChunk = [...overlapWords, word];
      currentTokens = countTokens(currentChunk.join(' '));
    } else {
      currentChunk.push(word);
      currentTokens += wordTokens;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}

/**
 * Recursively split content to fit within token limits.
 * Order: paragraphs -> sentences -> token window
 * NEVER rejects content - always produces valid chunks.
 */
function recursiveSplit(
  content: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const tokens = countTokens(content);
  
  // If content fits, return as-is
  if (tokens <= maxTokens) {
    return [content];
  }
  
  const chunks: string[] = [];
  
  // Try splitting by paragraphs first
  const paragraphs = splitByParagraphs(content);
  if (paragraphs.length > 1) {
    let currentChunk = '';
    let currentTokens = 0;
    
    for (const para of paragraphs) {
      const paraTokens = countTokens(para);
      
      // If single paragraph exceeds max, recursively split it
      if (paraTokens > maxTokens) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
          currentTokens = 0;
        }
        const subChunks = recursiveSplitParagraph(para, maxTokens, overlapTokens);
        chunks.push(...subChunks);
        continue;
      }
      
      if (currentTokens + paraTokens > maxTokens && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = para + '\n\n';
        currentTokens = paraTokens;
      } else {
        currentChunk += para + '\n\n';
        currentTokens += paraTokens;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  // Single paragraph - split by sentences
  return recursiveSplitParagraph(content, maxTokens, overlapTokens);
}

/**
 * Split a single paragraph that exceeds token limit.
 */
function recursiveSplitParagraph(
  paragraph: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  const tokens = countTokens(paragraph);
  
  if (tokens <= maxTokens) {
    return [paragraph];
  }
  
  // Try splitting by sentences
  const sentences = splitBySentences(paragraph);
  if (sentences.length > 1) {
    const chunks: string[] = [];
    let currentChunk = '';
    let currentTokens = 0;
    
    for (const sentence of sentences) {
      const sentenceTokens = countTokens(sentence);
      
      // If single sentence exceeds max, use token window
      if (sentenceTokens > maxTokens) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
          currentTokens = 0;
        }
        const windowChunks = splitByTokenWindow(sentence, maxTokens, overlapTokens);
        chunks.push(...windowChunks);
        continue;
      }
      
      if (currentTokens + sentenceTokens > maxTokens && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
        currentTokens = sentenceTokens;
      } else {
        currentChunk += sentence;
        currentTokens += sentenceTokens;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
  
  // Single long sentence - use token window
  return splitByTokenWindow(paragraph, maxTokens, overlapTokens);
}

/**
 * Build context header for a forum post chunk.
 * Provides thread/author context for better retrieval.
 */
function buildPostHeader(post: ForumPost): string {
  const date = new Date(post.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  
  return `[Thread: ${post.threadTitle}]\n[User: ${post.username} | ${date}]\n\n`;
}

/**
 * Chunk a single forum post.
 * 
 * Key guarantees:
 * - One post = one logical chunk (may split internally if too large)
 * - Never merges with other posts
 * - Preserves postId and subChunkIndex for identity
 * - NEVER rejects content due to size
 */
export function chunkForumPost(
  post: ForumPost,
  config: Partial<ForumIngestionConfig> = {},
  chunkType: 'original' | 'quoted' = 'original'
): ForumChunk[] {
  const maxTokens = config.maxTokens ?? 800;
  const overlapTokens = config.overlapTokens ?? 120;
  const embeddingModel = config.embeddingModel ?? 'baai/bge-m3';
  
  // Select content based on chunk type
  const rawContent = chunkType === 'original' ? post.content : post.contentFull;
  
  if (!rawContent || !rawContent.trim()) {
    logger.debug({
      postId: post.postId,
      threadId: post.threadId,
    }, 'Skipping empty post');
    return [];
  }
  
  // Build header for context
  const header = buildPostHeader(post);
  const headerTokens = countTokens(header);
  const effectiveMaxTokens = Math.max(maxTokens - headerTokens - 10, 100);
  
  // Split content if needed
  const contentChunks = recursiveSplit(rawContent, effectiveMaxTokens, overlapTokens);
  
  const chunks: ForumChunk[] = [];
  
  for (let i = 0; i < contentChunks.length; i++) {
    const chunkContent = contentChunks[i];
    const enrichedContent = header + chunkContent;
    const tokenCount = countTokens(enrichedContent);
    
    const metadata: ForumChunkMetadata = {
      threadId: post.threadId,
      postId: post.postId,
      subChunkIndex: i,
      username: post.username,
      userId: post.userId,
      date: post.date,
      threadTitle: post.threadTitle,
      forumCategory: post.forumCategory,
      forumPath: post.forumPath,
      page: post.page,
      anchor: post.anchor,
      keywords: post.keywords,
      mentions: post.mentions,
      hasLinks: post.hasLinks,
      hasImages: post.hasImages,
      images: post.images.length > 0 ? post.images : undefined,
      contentLength: post.contentLength,
      fingerprint: post.fingerprint,
      embeddingModel,
      chunkType,
    };
    
    const chunk: ForumChunk = {
      id: generateForumChunkId(post.threadId, post.postId, i, embeddingModel),
      content: enrichedContent,
      tokenCount,
      metadata,
    };
    
    chunks.push(chunk);
  }
  
  logger.debug({
    postId: post.postId,
    threadId: post.threadId,
    chunks: chunks.length,
    avgTokens: chunks.length > 0
      ? Math.round(chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length)
      : 0,
  }, 'Post chunked');
  
  return chunks;
}

/**
 * Chunk quoted content from a post (optional, separate pass).
 */
export function chunkQuotedContent(
  post: ForumPost,
  config: Partial<ForumIngestionConfig> = {}
): ForumChunk[] {
  if (!post.quotedContent || post.quotedContent.length === 0) {
    return [];
  }
  
  const maxTokens = config.maxTokens ?? 800;
  const overlapTokens = config.overlapTokens ?? 120;
  const embeddingModel = config.embeddingModel ?? 'baai/bge-m3';
  
  const chunks: ForumChunk[] = [];
  let subChunkIndex = 0;
  
  for (const quoted of post.quotedContent) {
    if (!quoted.text || !quoted.text.trim()) continue;
    
    const header = `[Thread: ${post.threadTitle}]\n[Quoted by: ${post.username}]${quoted.user ? ` [Originally by: ${quoted.user}]` : ''}\n\n`;
    const headerTokens = countTokens(header);
    const effectiveMaxTokens = Math.max(maxTokens - headerTokens - 10, 100);
    
    const contentChunks = recursiveSplit(quoted.text, effectiveMaxTokens, overlapTokens);
    
    for (const chunkContent of contentChunks) {
      const enrichedContent = header + chunkContent;
      const tokenCount = countTokens(enrichedContent);
      
      const metadata: ForumChunkMetadata = {
        threadId: post.threadId,
        postId: post.postId,
        subChunkIndex,
        username: post.username,
        userId: post.userId,
        date: post.date,
        threadTitle: post.threadTitle,
        forumCategory: post.forumCategory,
        forumPath: post.forumPath,
        page: post.page,
        anchor: post.anchor,
        keywords: post.keywords,
        mentions: post.mentions,
        hasLinks: post.hasLinks,
        hasImages: post.hasImages,
        contentLength: quoted.text.length,
        fingerprint: post.fingerprint,
        embeddingModel,
        chunkType: 'quoted',
      };
      
      chunks.push({
        id: generateForumChunkId(post.threadId, `${post.postId}_quoted`, subChunkIndex, embeddingModel),
        content: enrichedContent,
        tokenCount,
        metadata,
      });
      
      subChunkIndex++;
    }
  }
  
  return chunks;
}

/**
 * Chunk all posts in a thread.
 */
export function chunkForumThread(
  posts: ForumPost[],
  config: Partial<ForumIngestionConfig> = {}
): ForumChunk[] {
  const allChunks: ForumChunk[] = [];
  const embedQuotedContent = config.embedQuotedContent ?? false;
  
  for (const post of posts) {
    // Always chunk original content
    const originalChunks = chunkForumPost(post, config, 'original');
    allChunks.push(...originalChunks);
    
    // Optionally chunk quoted content
    if (embedQuotedContent) {
      const quotedChunks = chunkQuotedContent(post, config);
      allChunks.push(...quotedChunks);
    }
  }
  
  logger.info({
    posts: posts.length,
    chunks: allChunks.length,
    embedQuotedContent,
  }, 'Thread chunked');
  
  return allChunks;
}
