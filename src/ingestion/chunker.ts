import { createHash } from 'crypto';
import { encoding_for_model } from 'tiktoken';
import { env, logger } from '../config/index.js';
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
  };
}

interface ChunkerOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

let encoder: ReturnType<typeof encoding_for_model> | null = null;

function getEncoder() {
  if (!encoder) {
    encoder = encoding_for_model('gpt-4');
  }
  return encoder;
}

export function countTokens(text: string): number {
  const enc = getEncoder();
  return enc.encode(text).length;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function generateChunkId(
  sourceFile: string,
  sectionTitle: string,
  chunkIndex: number,
  contentHash: string
): string {
  const input = `${sourceFile}::${sectionTitle}::${chunkIndex}::${contentHash}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

interface Section {
  title: string;
  content: string;
  level: number;
}

function extractSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  
  let currentSection: Section = {
    title: 'Introduction',
    content: '',
    level: 0,
  };
  
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    
    if (headingMatch) {
      if (currentSection.content.trim()) {
        sections.push({ ...currentSection });
      }
      
      currentSection = {
        title: headingMatch[2].trim(),
        content: line + '\n',
        level: headingMatch[1].length,
      };
    } else {
      currentSection.content += line + '\n';
    }
  }
  
  if (currentSection.content.trim()) {
    sections.push(currentSection);
  }
  
  return sections;
}

function splitSectionIntoChunks(
  section: Section,
  options: ChunkerOptions
): string[] {
  const chunks: string[] = [];
  const lines = section.content.split('\n');
  
  let currentChunk = '';
  let currentTokens = 0;
  
  for (const line of lines) {
    const lineTokens = countTokens(line);
    
    if (currentTokens + lineTokens > options.maxTokens && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      
      const overlapLines = currentChunk.split('\n').slice(-3).join('\n');
      currentChunk = overlapLines + '\n' + line + '\n';
      currentTokens = countTokens(currentChunk);
    } else {
      currentChunk += line + '\n';
      currentTokens += lineTokens;
    }
    
    if (currentTokens >= options.targetTokens && line.trim() === '') {
      chunks.push(currentChunk.trim());
      currentChunk = '';
      currentTokens = 0;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

export function chunkDocument(
  doc: DocFile,
  options?: Partial<ChunkerOptions>
): DocChunk[] {
  const opts: ChunkerOptions = {
    targetTokens: options?.targetTokens ?? env.CHUNK_TARGET_TOKENS,
    maxTokens: options?.maxTokens ?? env.CHUNK_MAX_TOKENS,
    overlapTokens: options?.overlapTokens ?? env.CHUNK_OVERLAP_TOKENS,
  };

  const sections = extractSections(doc.content);
  const chunks: DocChunk[] = [];
  
  let globalChunkIndex = 0;
  
  for (const section of sections) {
    const sectionChunks = splitSectionIntoChunks(section, opts);
    
    for (const chunkContent of sectionChunks) {
      if (!chunkContent.trim()) continue;
      
      const contentHash = hashContent(chunkContent);
      
      // Add context header to chunk
      const enrichedContent = `# ${doc.title}\n\n## ${section.title}\n\n${chunkContent}`;
      
      chunks.push({
        id: generateChunkId(doc.filePath, section.title, globalChunkIndex, contentHash),
        content: enrichedContent,
        tokenCount: countTokens(enrichedContent),
        metadata: {
          source_file: doc.filePath,
          doc_title: doc.title,
          section_title: section.title,
          doc_category: doc.category,
          url_path: doc.urlPath,
          chunk_index: globalChunkIndex,
          content_hash: contentHash,
          last_modified: doc.lastModified.toISOString(),
        },
      });
      
      globalChunkIndex++;
    }
  }
  
  logger.debug({ file: doc.filePath, chunks: chunks.length }, 'Chunked document');
  
  return chunks;
}

export function chunkDocuments(docs: DocFile[]): DocChunk[] {
  const allChunks: DocChunk[] = [];
  
  for (const doc of docs) {
    const chunks = chunkDocument(doc);
    allChunks.push(...chunks);
  }
  
  logger.info({ documents: docs.length, chunks: allChunks.length }, 'Finished chunking all documents');
  
  return allChunks;
}
