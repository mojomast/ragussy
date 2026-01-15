import { ChatOpenAI } from '@langchain/openai';
import { env, logger, getSystemPrompt } from '../config/index.js';
import fs from 'fs/promises';
import path from 'path';

let chatModel: ChatOpenAI | null = null;

// Cache for dynamic env values with TTL
let dynamicEnvCache: Record<string, string> | null = null;
let dynamicEnvCacheTime = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

let envLastModified = 0;
let refreshPromise: Promise<Record<string, string>> | null = null;

/**
 * Parse .env file to get current values (for settings that can change at runtime)
 */
async function parseEnvFile(): Promise<Record<string, string>> {
  const now = Date.now();
  if (dynamicEnvCache && (now - dynamicEnvCacheTime) < CACHE_TTL_MS) {
    return dynamicEnvCache;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const envPath = path.join(process.cwd(), '.env');
      let stats;
      try {
        stats = await fs.stat(envPath);
      } catch {
        // File likely doesn't exist, proceed to readFile to handle error standard way
      }

      if (stats && dynamicEnvCache && stats.mtimeMs === envLastModified) {
        dynamicEnvCacheTime = Date.now();
        return dynamicEnvCache;
      }

      const content = await fs.readFile(envPath, 'utf-8');
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
      
      dynamicEnvCache = envVars;
      dynamicEnvCacheTime = Date.now();
      if (stats) {
        envLastModified = stats.mtimeMs;
      }
      return envVars;
    } catch {
      // Fall back to process.env
      return {};
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Get embedding configuration, reading fresh values from .env file
 */
async function getEmbedConfig() {
  const fileEnv = await parseEnvFile();
  
  return {
    baseUrl: fileEnv.EMBED_BASE_URL || env.EMBED_BASE_URL,
    apiKey: fileEnv.EMBED_API_KEY || env.EMBED_API_KEY,
    model: fileEnv.EMBED_MODEL || env.EMBED_MODEL,
    vectorDim: parseInt(fileEnv.VECTOR_DIM || String(env.VECTOR_DIM)),
  };
}

export function getChatModel(): ChatOpenAI {
  if (!chatModel) {
    chatModel = new ChatOpenAI({
      openAIApiKey: env.LLM_API_KEY,
      modelName: env.LLM_MODEL,
      temperature: 0.1,
      maxTokens: env.LLM_MAX_TOKENS,
      configuration: {
        baseURL: env.LLM_BASE_URL,
      },
    });
    logger.info({ model: env.LLM_MODEL, baseUrl: env.LLM_BASE_URL }, 'Chat model initialized');
  }
  return chatModel;
}

export async function embedText(text: string): Promise<number[]> {
  const embeddings = await embedTexts([text]);
  return embeddings[0];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  // Get fresh config from .env file
  const embedConfig = await getEmbedConfig();
  
  logger.debug({
    baseUrl: embedConfig.baseUrl,
    model: embedConfig.model,
    vectorDim: embedConfig.vectorDim,
  }, 'Using embedding configuration');

  const response = await fetch(`${embedConfig.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${embedConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: embedConfig.model,
      input: texts,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({
      status: response.status,
      error: errorText,
      model: embedConfig.model,
      baseUrl: embedConfig.baseUrl,
    }, 'Embedding API request failed');
    throw new Error(`Embedding API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const observedDim = data.data[0]?.embedding?.length;
  
  logger.info({
    model: embedConfig.model,
    count: texts.length,
    dimension: observedDim,
  }, 'Embeddings generated');

  // Validate embedding dimension matches configuration
  if (observedDim !== embedConfig.vectorDim) {
    throw new Error(
      `Embedding dimension mismatch: observed ${observedDim}, expected ${embedConfig.vectorDim}. ` +
      `Update VECTOR_DIM in Settings to ${observedDim} to match your embedding model (${embedConfig.model}).`
    );
  }

  return data.data.map((item: any) => item.embedding);
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function generateAnswer(
  messages: ChatMessage[],
  context: string
): Promise<string> {
  const model = getChatModel();
  const systemPrompt = getSystemPrompt(context);

  const formattedMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  const response = await model.invoke(formattedMessages);
  return response.content as string;
}
