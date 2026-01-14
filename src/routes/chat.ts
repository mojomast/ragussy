import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { logger, env } from '../config/index.js';
import { embedText, generateAnswer, searchVectors, type ChatMessage } from '../services/index.js';
import { countTokens } from '../ingestion/chunker.js';

const router: Router = Router();

// In-memory conversation store
const conversations = new Map<string, ChatMessage[]>();

const chatRequestSchema = z.object({
  message: z.string().min(1).max(20000),
  conversationId: z.string().optional(),
});

interface Source {
  title: string;
  url: string;
  section: string;
  relevance: number;
}

// API Key authentication middleware
function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
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

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const validation = chatRequestSchema.safeParse(req.body);
    if (!validation.success) {
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

    for (const result of searchResults) {
      const payload = result.payload;
      const url = `${env.PUBLIC_DOCS_BASE_URL}${payload.url_path}`;
      
      sources.push({
        title: payload.doc_title as string,
        url,
        section: payload.section_title as string,
        relevance: result.score,
      });

      contextParts.push(`---
Source: ${payload.doc_title} > ${payload.section_title}
URL: ${url}

${payload.content || 'Content not available'}
---`);
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

    logger.info({ conversationId, sourcesFound: uniqueSources.length }, 'Chat response generated');

    return res.json({
      answer,
      sources: uniqueSources.slice(0, 5),
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

router.delete('/chat/:conversationId', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  conversations.delete(conversationId);
  return res.json({ success: true });
});

export default router;
