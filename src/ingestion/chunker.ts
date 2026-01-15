import { createHash } from 'crypto';
import { encoding_for_model, type Tiktoken } from 'tiktoken';
import { logger } from '../config/index.js';
import type { DocFile } from './document-reader.js';

export interface DocChunk {
  id: string;
  content: string;
  tokenCount: number;
  metadata: {
    source_file: string;
    doc_title: string;
    section_title: string;
    doc_category: string;
    url_path: string;
    chunk_index: number;
    content_hash: string;
    last_modified: string;
    images?: string[];
    embedding_model?: string;
  };
}

export interface ChunkerConfig {
  maxTokens: number;           // Soft limit for chunking (default: 800)
  overlapTokens: number;       // Overlap between chunks (default: 120)
  absoluteMaxTokens: number;   // Hard limit - never exceed (default: 1024)
  embeddingModel?: string;     // For deterministic chunk IDs
}

const DEFAULT_CONFIG: ChunkerConfig = {
  maxTokens: 800,
  overlapTokens: 120,
  absoluteMaxTokens: 1024,
};

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

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Generate deterministic chunk ID from:
 * - File path
 * - Section identifier
 * - Chunk index
 * - Embedding model name (for stability across model changes)
 */
function generateChunkId(
  sourceFile: string,
  sectionTitle: string,
  chunkIndex: number,
  embeddingModel: string = 'default'
): string {
  const input = `${sourceFile}::${sectionTitle}::${chunkIndex}::${embeddingModel}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

interface MarkdownSection {
  title: string;
  level: number;
  content: string;
  headingLine: string;
}

/**
 * Parse markdown into sections based on headings.
 */
function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  
  let currentSection: MarkdownSection = {
    title: 'Introduction',
    level: 0,
    content: '',
    headingLine: '',
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      if (currentSection.content.trim() || currentSection.headingLine) {
        sections.push({ ...currentSection });
      }
      
      currentSection = {
        title: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: '',
        headingLine: line,
      };
    } else {
      currentSection.content += line + '\n';
    }
  }
  
  if (currentSection.content.trim() || currentSection.headingLine) {
    sections.push(currentSection);
  }
  
  return sections;
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
 * This is the last resort for text that can't be split by sentences.
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
  overlapTokens: number,
  absoluteMaxTokens: number
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
        // Recursively split the large paragraph
        const subChunks = recursiveSplitParagraph(para, maxTokens, overlapTokens, absoluteMaxTokens);
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
  return recursiveSplitParagraph(content, maxTokens, overlapTokens, absoluteMaxTokens);
}

/**
 * Split a single paragraph that exceeds token limit.
 * Tries sentences first, then falls back to token window.
 */
function recursiveSplitParagraph(
  paragraph: string,
  maxTokens: number,
  overlapTokens: number,
  absoluteMaxTokens: number
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
        // Split by token window
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

interface ContentBlock {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

/**
 * Split content into text and code blocks.
 */
function splitIntoBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      if (textContent.trim()) {
        blocks.push({ type: 'text', content: textContent });
      }
    }
    
    blocks.push({
      type: 'code',
      content: match[0],
      language: match[1] || undefined,
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      blocks.push({ type: 'text', content: remaining });
    }
  }
  
  return blocks;
}

/**
 * Split a code block that exceeds the absolute max tokens.
 * Preserves code fence markers.
 */
function splitCodeBlock(
  codeBlock: string,
  maxTokens: number,
  overlapTokens: number
): string[] {
  // Extract language and content
  const match = codeBlock.match(/```(\w*)\n([\s\S]*?)```/);
  if (!match) return [codeBlock];
  
  const language = match[1];
  const code = match[2];
  const codeTokens = countTokens(code);
  
  // Reserve tokens for fences
  const fenceOverhead = countTokens('```' + language + '\n```');
  const effectiveMax = maxTokens - fenceOverhead;
  
  if (codeTokens <= effectiveMax) {
    return [codeBlock];
  }
  
  // Split code by lines
  const lines = code.split('\n');
  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentTokens = 0;
  
  for (const line of lines) {
    const lineTokens = countTokens(line + '\n');
    
    if (currentTokens + lineTokens > effectiveMax && currentLines.length > 0) {
      chunks.push('```' + language + '\n' + currentLines.join('\n') + '\n```');
      
      // Overlap: keep last few lines
      const overlapLines: string[] = [];
      let overlapCount = 0;
      for (let i = currentLines.length - 1; i >= 0 && overlapCount < overlapTokens; i--) {
        const lt = countTokens(currentLines[i] + '\n');
        if (overlapCount + lt <= overlapTokens) {
          overlapLines.unshift(currentLines[i]);
          overlapCount += lt;
        } else {
          break;
        }
      }
      
      currentLines = [...overlapLines, line];
      currentTokens = countTokens(currentLines.join('\n'));
    } else {
      currentLines.push(line);
      currentTokens += lineTokens;
    }
  }
  
  if (currentLines.length > 0) {
    chunks.push('```' + language + '\n' + currentLines.join('\n') + '\n```');
  }
  
  return chunks;
}

/**
 * Chunk a section with recursive splitting.
 * NEVER rejects content - always produces valid chunks.
 */
function chunkSection(
  section: MarkdownSection,
  config: ChunkerConfig
): string[] {
  const chunks: string[] = [];
  const blocks = splitIntoBlocks(section.content);
  
  const headerPrefix = section.headingLine ? section.headingLine + '\n\n' : '';
  const headerTokens = countTokens(headerPrefix);
  const effectiveMax = config.maxTokens - headerTokens;
  
  let currentChunk = headerPrefix;
  let currentTokens = headerTokens;
  
  for (const block of blocks) {
    const blockTokens = countTokens(block.content);
    
    if (block.type === 'code') {
      // Check if code block exceeds absolute max
      if (blockTokens > config.absoluteMaxTokens) {
        // Flush current chunk
        if (currentChunk.trim() && currentChunk !== headerPrefix) {
          chunks.push(currentChunk.trim());
        }
        
        // Split the code block
        const codeChunks = splitCodeBlock(block.content, config.absoluteMaxTokens, config.overlapTokens);
        for (const cc of codeChunks) {
          chunks.push((headerPrefix + cc).trim());
        }
        
        currentChunk = headerPrefix;
        currentTokens = headerTokens;
        continue;
      }
      
      // Code block fits - check if it fits in current chunk
      if (currentTokens + blockTokens > config.maxTokens && currentChunk.trim() !== headerPrefix.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = headerPrefix + block.content + '\n\n';
        currentTokens = headerTokens + blockTokens + 2;
      } else {
        currentChunk += block.content + '\n\n';
        currentTokens += blockTokens + 2;
      }
    } else {
      // Text block - can be recursively split
      if (currentTokens + blockTokens <= config.maxTokens) {
        currentChunk += block.content;
        currentTokens += blockTokens;
      } else {
        // Need to split text
        const textChunks = recursiveSplit(
          block.content,
          effectiveMax,
          config.overlapTokens,
          config.absoluteMaxTokens
        );
        
        for (let i = 0; i < textChunks.length; i++) {
          const textChunk = textChunks[i];
          const textTokens = countTokens(textChunk);
          
          if (i === 0 && currentTokens + textTokens <= config.maxTokens) {
            currentChunk += textChunk;
            currentTokens += textTokens;
          } else {
            if (currentChunk.trim() && currentChunk !== headerPrefix) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = headerPrefix + textChunk;
            currentTokens = headerTokens + textTokens;
          }
        }
      }
    }
  }
  
  if (currentChunk.trim() && currentChunk !== headerPrefix) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * Validate chunk token count.
 * Logs warning but does NOT throw - we never reject chunks.
 */
export function validateChunkTokens(chunk: DocChunk, maxTokens: number): boolean {
  if (chunk.tokenCount > maxTokens) {
    logger.warn({
      file: chunk.metadata.source_file,
      section: chunk.metadata.section_title,
      chunkIndex: chunk.metadata.chunk_index,
      tokenCount: chunk.tokenCount,
      maxTokens,
    }, 'Chunk exceeds soft token limit');
    return false;
  }
  return true;
}

/**
 * Chunk a document into token-limited chunks.
 * 
 * Key guarantees:
 * - NEVER rejects content due to size
 * - Recursively splits: paragraphs -> sentences -> token window
 * - Preserves markdown structure when possible
 * - Deterministic chunk IDs for resumability
 */
export function chunkDocument(
  doc: DocFile,
  config: Partial<ChunkerConfig> = {}
): DocChunk[] {
  const cfg: ChunkerConfig = {
    maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    overlapTokens: config.overlapTokens ?? DEFAULT_CONFIG.overlapTokens,
    absoluteMaxTokens: config.absoluteMaxTokens ?? DEFAULT_CONFIG.absoluteMaxTokens,
    embeddingModel: config.embeddingModel,
  };

  // Reserve space for document title header
  const headerTemplate = `# ${doc.title}\n\n`;
  const headerTokens = countTokens(headerTemplate);
  
  const effectiveConfig: ChunkerConfig = {
    maxTokens: Math.max(cfg.maxTokens - headerTokens - 10, 100),
    overlapTokens: cfg.overlapTokens,
    absoluteMaxTokens: cfg.absoluteMaxTokens,
    embeddingModel: cfg.embeddingModel,
  };

  const sections = parseMarkdownSections(doc.content);
  const chunks: DocChunk[] = [];
  
  let globalChunkIndex = 0;
  
  for (const section of sections) {
    const sectionChunks = chunkSection(section, effectiveConfig);
    
    for (const chunkContent of sectionChunks) {
      if (!chunkContent.trim()) continue;
      
      const contentHash = hashContent(chunkContent);
      const enrichedContent = `# ${doc.title}\n\n${chunkContent}`;
      const tokenCount = countTokens(enrichedContent);
      
      // Log structured info for observability
      logger.debug({
        file: doc.filePath,
        section: section.title,
        chunkIndex: globalChunkIndex,
        tokenCount,
        maxTokens: cfg.maxTokens,
      }, 'Chunk created');
      
      const chunk: DocChunk = {
        id: generateChunkId(
          doc.filePath,
          section.title,
          globalChunkIndex,
          cfg.embeddingModel || 'default'
        ),
        content: enrichedContent,
        tokenCount,
        metadata: {
          source_file: doc.filePath,
          doc_title: doc.title,
          section_title: section.title,
          doc_category: doc.category,
          url_path: doc.urlPath,
          chunk_index: globalChunkIndex,
          content_hash: contentHash,
          last_modified: doc.lastModified.toISOString(),
          images: doc.images,
          embedding_model: cfg.embeddingModel,
        },
      };
      
      chunks.push(chunk);
      globalChunkIndex++;
    }
  }
  
  logger.info({
    file: doc.filePath,
    chunks: chunks.length,
    sections: sections.length,
    avgTokens: chunks.length > 0 
      ? Math.round(chunks.reduce((sum, c) => sum + c.tokenCount, 0) / chunks.length)
      : 0,
  }, 'Document chunked');
  
  return chunks;
}

/**
 * Chunk multiple documents.
 */
export function chunkDocuments(
  docs: DocFile[],
  config: Partial<ChunkerConfig> = {}
): DocChunk[] {
  const allChunks: DocChunk[] = [];
  
  for (const doc of docs) {
    const chunks = chunkDocument(doc, config);
    allChunks.push(...chunks);
  }
  
  logger.info({
    documents: docs.length,
    chunks: allChunks.length,
  }, 'Finished chunking all documents');
  
  return allChunks;
}
