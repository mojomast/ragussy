import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env file
dotenv.config();

const envSchema = z.object({
  // Server
  PORT: z.string().default('3001').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Project Identity
  PROJECT_NAME: z.string().default('Documentation'),
  PUBLIC_DOCS_BASE_URL: z.string().url().default('https://docs.example.com'),

  // Document Source
  DOCS_PATH: z.string().default('./docs'),
  DOCS_EXTENSIONS: z.string().default('.md,.mdx'),

  // Qdrant
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('docs'),
  VECTOR_DIM: z.string().default('1536').transform(Number),

  // LLM Provider (optional during setup)
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_MAX_TOKENS: z.string().default('4096').transform(Number),

  // Embeddings (optional during setup)
  EMBED_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  EMBED_API_KEY: z.string().default(''),
  EMBED_MODEL: z.string().default('text-embedding-3-small'),

  // RAG Configuration
  MAX_CONTEXT_TOKENS: z.string().default('4000').transform(Number),
  RETRIEVAL_TOP_K: z.string().default('6').transform(Number),
  CHUNK_TARGET_TOKENS: z.string().default('600').transform(Number),
  CHUNK_MAX_TOKENS: z.string().default('800').transform(Number),
  CHUNK_OVERLAP_TOKENS: z.string().default('120').transform(Number),
  ABSOLUTE_MAX_TOKENS: z.string().default('1024').transform(Number),
  EMBEDDING_THREADS: z.string().default('4').transform(Number),
  UPSERT_THREADS: z.string().default('2').transform(Number),
  FAIL_FAST_VALIDATION: z.string().default('false').transform(v => v === 'true'),
  EMBED_BATCH_SIZE: z.string().default('50').transform(Number),

  // Security (optional during setup)
  API_KEY: z.string().default(''),
  ADMIN_TOKEN: z.string().default(''),

  // Optional
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Custom System Prompt
  CUSTOM_SYSTEM_PROMPT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    console.error('\n💡 Run `npm run setup` to configure your environment.');
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();

// Derived configuration
export function getDocsExtensions(): string[] {
  return env.DOCS_EXTENSIONS.split(',').map(ext => ext.trim());
}

export function getDocsPath(): string {
  return path.resolve(env.DOCS_PATH);
}

export function getSystemPrompt(context: string): string {
  if (env.CUSTOM_SYSTEM_PROMPT) {
    return env.CUSTOM_SYSTEM_PROMPT
      .replace('{PROJECT_NAME}', env.PROJECT_NAME)
      .replace('{CONTEXT}', context);
  }

  return `You are a helpful assistant that answers questions about ${env.PROJECT_NAME}.

IMPORTANT RULES:
1. ONLY answer based on the provided context. Do not use outside knowledge.
2. If the context doesn't contain enough information to answer, say so clearly and suggest where the user might find more information.
3. Always cite your sources by referencing the document titles and sections.
4. Be concise but thorough. Use bullet points and code examples when helpful.
5. If asked about something unrelated to ${env.PROJECT_NAME}, politely redirect to relevant topics.
6. When the context mentions [image], note that related images are displayed separately in the UI. Do NOT output image URLs - just reference that images are available.
7. For forum discussions, attribute opinions to specific users when relevant (e.g., "User X mentioned...").

CONTEXT FROM DOCUMENTATION:
${context}`;
}
