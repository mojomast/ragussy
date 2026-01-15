// @ts-nocheck
import fs from 'fs/promises';
import path from 'path';
import fm from 'front-matter';
import { logger, getDocsPath, getDocsExtensions } from '../config/index.js';

export interface DocFile {
  filePath: string;          // Relative path from docs root
  absolutePath: string;      // Full filesystem path
  content: string;           // Raw markdown content (without frontmatter)
  title: string;             // From frontmatter or first heading
  description?: string;      // From frontmatter
  category: string;          // Top-level directory
  urlPath: string;           // URL path for the doc
  lastModified: Date;
  images?: string[];         // Image URLs associated with this content
}

interface Frontmatter {
  title?: string;
  description?: string;
  sidebar_label?: string;
  sidebar_position?: number;
  [key: string]: unknown;
}

// JSON thread/post structure
interface JsonPost {
  postId: string;
  content: string;
  contentFull?: string;
  images?: string[];
  username?: string;
  date?: string;
  anchor?: string;
  [key: string]: unknown;
}

interface JsonThread {
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
  forumCategory?: string;
  posts?: JsonPost[];
  [key: string]: unknown;
}

const IGNORED_PATTERNS = [
  /node_modules/,
  /\.git/,
  /^_/,
  /\.DS_Store/,
];

function shouldIgnore(filePath: string): boolean {
  const fileName = path.basename(filePath);
  if (fileName.startsWith('_') || fileName.startsWith('.')) {
    return true;
  }
  const pathPatterns = [/node_modules/, /\.git/, /\.DS_Store/];
  return pathPatterns.some(pattern => pattern.test(filePath));
}

function extractTitleFromContent(content: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }
  return 'Untitled';
}

function getCategory(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  if (parts.length > 1) {
    return parts[0];
  }
  return 'root';
}

function getUrlPath(relativePath: string): string {
  let urlPath = relativePath
    .replace(/\\/g, '/')
    .replace(/\.mdx?$/, '')
    .replace(/\/index$/, '');
  
  if (!urlPath.startsWith('/')) {
    urlPath = '/' + urlPath;
  }
  
  return urlPath;
}

function extractImagesFromMarkdown(content: string): string[] {
  const images: string[] = [];
  const imgRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    images.push(match[1]);
  }
  return images;
}

function readJsonDocFile(raw: string, absolutePath: string, relativePath: string, lastModified: Date): DocFile | null {
  try {
    const data: JsonThread = JSON.parse(raw);
    
    const contentParts: string[] = [];
    const allImages: string[] = [];
    
    if (data.threadTitle) {
      contentParts.push(`# ${data.threadTitle}\n`);
    }
    if (data.forumCategory) {
      contentParts.push(`Category: ${data.forumCategory}\n`);
    }
    if (data.threadUrl) {
      contentParts.push(`Source: ${data.threadUrl}\n`);
    }
    contentParts.push('\n---\n');
    
    if (data.posts && Array.isArray(data.posts)) {
      for (const post of data.posts) {
        const postContent = post.contentFull || post.content || '';
        if (!postContent.trim()) continue;
        
        const postHeader = post.username ? `**${post.username}**` : '';
        const postDate = post.date ? ` (${new Date(post.date).toLocaleDateString()})` : '';
        
        if (postHeader || postDate) {
          contentParts.push(`\n${postHeader}${postDate}:\n`);
        }
        contentParts.push(postContent);
        contentParts.push('\n');
        
        if (post.images && Array.isArray(post.images)) {
          allImages.push(...post.images);
        }
      }
    }
    
    const content = contentParts.join('\n');
    const title = data.threadTitle || path.basename(relativePath, '.json');
    
    logger.debug({ 
      filePath: relativePath, 
      contentLength: content.length,
      postsCount: data.posts?.length || 0,
      imagesCount: allImages.length,
    }, 'Read JSON doc file');
    
    return {
      filePath: relativePath,
      absolutePath,
      content,
      title,
      description: data.forumCategory,
      category: getCategory(relativePath),
      urlPath: getUrlPath(relativePath).replace('.json', ''),
      lastModified,
      images: allImages.length > 0 ? allImages : undefined,
    };
  } catch (error) {
    logger.error({ error, path: absolutePath }, 'Failed to parse JSON doc file');
    return null;
  }
}

export async function readDocFile(absolutePath: string, relativePath: string): Promise<DocFile | null> {
  try {
    const raw = await fs.readFile(absolutePath, 'utf-8');
    const stats = await fs.stat(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    
    if (ext === '.json') {
      return readJsonDocFile(raw, absolutePath, relativePath, stats.mtime);
    }
    
    const result = fm<Frontmatter>(raw);
    const { attributes, body } = result;
    
    logger.debug({ filePath: relativePath, contentLength: body.length }, 'Read doc file');
    
    const title = attributes.title || 
                  attributes.sidebar_label || 
                  extractTitleFromContent(body);
    
    const images = extractImagesFromMarkdown(body);
    
    return {
      filePath: relativePath,
      absolutePath,
      content: body,
      title,
      description: attributes.description,
      category: getCategory(relativePath),
      urlPath: getUrlPath(relativePath),
      lastModified: stats.mtime,
      images: images.length > 0 ? images : undefined,
    };
  } catch (error) {
    logger.error({ error, path: absolutePath }, 'Failed to read doc file');
    return null;
  }
}

export async function* walkDocs(docsDir: string): AsyncGenerator<{ absolutePath: string; relativePath: string }> {
  const extensions = getDocsExtensions();
  const allExtensions = [...extensions, '.json'];
  const extPattern = new RegExp(`(${allExtensions.map(e => e.replace('.', '\\.')).join('|')})$`);

  async function* walk(dir: string, baseDir: string): AsyncGenerator<{ absolutePath: string; relativePath: string }> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, absolutePath);
      
      if (shouldIgnore(relativePath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        yield* walk(absolutePath, baseDir);
      } else if (entry.isFile() && extPattern.test(entry.name)) {
        yield { absolutePath, relativePath };
      }
    }
  }
  
  yield* walk(docsDir, docsDir);
}

export async function readAllDocs(): Promise<DocFile[]> {
  const docsPath = getDocsPath();
  logger.info({ docsPath }, 'Reading docs from directory');
  
  const docs: DocFile[] = [];
  
  for await (const { absolutePath, relativePath } of walkDocs(docsPath)) {
    const doc = await readDocFile(absolutePath, relativePath);
    if (doc) {
      docs.push(doc);
    }
  }
  
  logger.info({ count: docs.length }, 'Read all doc files');
  return docs;
}
