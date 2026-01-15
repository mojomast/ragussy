import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { logger, env } from '../config/index.js';
import { embedText, generateAnswer, searchVectors, type ChatMessage } from '../services/index.js';
import { countTokens } from '../ingestion/chunker.js';

const router: Router = Router();

// In-memory conversation store
const conversations = new Map<string, ChatMessage[]>();
// Store images per conversation for "load more" functionality
const conversationImages = new Map<string, ImageResult[]>();

const chatRequestSchema = z.object({
  message: z.string().min(1).max(20000),
  conversationId: z.string().optional().nullable(),
});

interface Source {
  title: string;
  url: string;
  section: string;
  relevance: number;
}

interface ImageResult {
  url: string;
  sourceTitle: string;
  relevance: number;
}

// Strip image URLs from content to avoid LLM outputting them as text
function stripImageUrls(content: string): string {
  // Remove common image URL patterns
  return content
    // Remove standalone image URLs (http/https ending in image extensions)
    .replace(/https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s]*)?/gi, '[image]')
    // Remove markdown image syntax
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '[image]')
    // Remove HTML img tags
    .replace(/<img[^>]*>/gi, '[image]')
    // Clean up multiple [image] markers
    .replace(/(\[image\]\s*)+/g, '[image] ')
    .trim();
}

// API Key authentication middleware
function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // Check if system is configured
  if (!env.API_KEY || !env.LLM_API_KEY || !env.EMBED_API_KEY) {
    return res.status(503).json({ 
      error: 'System not configured',
      message: 'Please complete the initial setup first'
    });
  }
  
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }
  
  if (apiKey !== env.API_KEY) {
    logger.warn({ ip: req.ip }, 'Invalid API key attempt');
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  next();
}

router.use(apiKeyAuth);

router.post('/', async (req: Request, res: Response) => {
  try {
    logger.debug({ body: req.body }, 'Chat request received');
    
    const validation = chatRequestSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn({ errors: validation.error.issues, body: req.body }, 'Chat validation failed');
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.issues,
      });
    }

    const { message, conversationId: existingConversationId } = validation.data;
    const conversationId = existingConversationId || nanoid();
    
    logger.info({ conversationId, messageLength: message.length }, 'Processing chat request');

    let history = conversations.get(conversationId) || [];
    history.push({ role: 'user', content: message });

    const queryEmbedding = await embedText(message);
    const searchResults = await searchVectors(queryEmbedding, env.RETRIEVAL_TOP_K);

    const sources: Source[] = [];
    const contextParts: string[] = [];
    const allImages: ImageResult[] = [];

    for (const result of searchResults) {
      const payload = result.payload;
      const isForumPost = payload.docType === 'forum_post';
      
      let title: string;
      let url: string;
      let section: string;
      
      if (isForumPost) {
        // Forum post payload
        title = payload.threadTitle as string || 'Forum Thread';
        section = `Post by ${payload.username || 'Unknown'} (${payload.date ? new Date(payload.date as string).toLocaleDateString() : 'Unknown date'})`;
        url = payload.anchor as string || '#';
      } else {
        // Document payload
        title = payload.doc_title as string || 'Document';
        section = payload.section_title as string || '';
        url = `${env.PUBLIC_DOCS_BASE_URL}${payload.url_path || ''}`;
      }
      
      sources.push({
        title,
        url,
        section,
        relevance: result.score,
      });

      // Get content and strip image URLs to prevent LLM from outputting them
      const rawContent = payload.content as string || 'Content not available';
      const cleanContent = stripImageUrls(rawContent);

      if (isForumPost) {
        contextParts.push(`---
Source: ${title}
${section}
Thread: ${payload.threadId}, Post: ${payload.postId}

${cleanContent}
---`);
      } else {
        contextParts.push(`---
Source: ${title} > ${section}
URL: ${url}

${cleanContent}
---`);
      }

      // Collect images from search results
      const images = payload.images as string[] | undefined;
      if (images && Array.isArray(images)) {
        for (const imgUrl of images) {
          allImages.push({
            url: imgUrl,
            sourceTitle: isForumPost ? `${title} - ${section}` : title,
            relevance: result.score,
          });
        }
      }
    }

    const context = contextParts.join('\n\n');
    logger.debug({ contextTokenCount: countTokens(context) }, 'Built context');

    const recentHistory = history.slice(-8);
    const answer = await generateAnswer(recentHistory, context);

    history.push({ role: 'assistant', content: answer });

    if (history.length > 20) {
      history = history.slice(-20);
    }
    conversations.set(conversationId, history);

    const uniqueSources = sources.reduce((acc, source) => {
      if (!acc.some(s => s.url === source.url)) {
        acc.push(source);
      }
      return acc;
    }, [] as Source[]);

    // Deduplicate and sort images by relevance
    const uniqueImages = allImages.reduce((acc, img) => {
      if (!acc.some(i => i.url === img.url)) {
        acc.push(img);
      }
      return acc;
    }, [] as ImageResult[]);
    uniqueImages.sort((a, b) => b.relevance - a.relevance);

    // Store all images for "load more" pagination
    conversationImages.set(conversationId, uniqueImages);

    logger.info({ 
      conversationId, 
      sourcesFound: uniqueSources.length,
      imagesFound: uniqueImages.length,
    }, 'Chat response generated');

    return res.json({
      answer,
      sources: uniqueSources.slice(0, 5),
      images: uniqueImages.slice(0, 5),  // Return top 5 most relevant images
      totalImages: uniqueImages.length,   // Total available for "load more"
      conversationId,
    });
  } catch (error) {
    logger.error({ error }, 'Chat endpoint error');
    return res.status(500).json({
      error: 'Failed to process request',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.delete('/:conversationId', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  conversations.delete(conversationId);
  conversationImages.delete(conversationId);  // Clean up images too
  return res.json({ success: true });
});

router.get('/:conversationId/images', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const offset = parseInt(req.query.offset as string) || 0;
  const limit = parseInt(req.query.limit as string) || 5;
  
  const images = conversationImages.get(conversationId) || [];
  const paginatedImages = images.slice(offset, offset + limit);
  
  return res.json({
    images: paginatedImages,
    total: images.length,
    hasMore: offset + limit < images.length,
  });
});

export default router;
