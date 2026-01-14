import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../config/index.js';

const router: Router = Router();
const ENV_PATH = path.join(process.cwd(), '.env');
const SETUP_COMPLETE_PATH = path.join(process.cwd(), 'data', '.setup-complete');

interface Settings {
  projectName: string;
  publicDocsBaseUrl: string;
  docsPath: string;
  docsExtensions: string;
  qdrantUrl: string;
  qdrantCollection: string;
  vectorDim: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmMaxTokens: number;
  embedBaseUrl: string;
  embedApiKey: string;
  embedModel: string;
  maxContextTokens: number;
  retrievalTopK: number;
  chunkTargetTokens: number;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  apiKey: string;
  adminToken: string;
  customSystemPrompt: string;
  // Discord Bot
  discordBotEnabled: boolean;
  discordBotToken: string;
  discordClientId: string;
  discordGuildId: string;
  discordBotName: string;
  discordCommandPrefix: string;
  discordEmbedColor: string;
  discordCooldownSeconds: number;
}

async function parseEnvFile(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(ENV_PATH, 'utf-8');
    const env: Record<string, string> = {};
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        env[key] = value;
      }
    }
    
    return env;
  } catch {
    return {};
  }
}

async function writeEnvFile(env: Record<string, string>): Promise<void> {
  const content = `# Ragussy Configuration
# Generated on ${new Date().toISOString()}

# ===================
# Server Configuration
# ===================
PORT=${env.PORT || '3001'}
NODE_ENV=${env.NODE_ENV || 'development'}

# ===================
# Project Identity
# ===================
PROJECT_NAME=${env.PROJECT_NAME || 'My Documentation'}
PUBLIC_DOCS_BASE_URL=${env.PUBLIC_DOCS_BASE_URL || 'https://docs.example.com'}

# ===================
# Document Source
# ===================
DOCS_PATH=${env.DOCS_PATH || './docs'}
DOCS_EXTENSIONS=${env.DOCS_EXTENSIONS || '.md,.mdx'}

# ===================
# Vector Database (Qdrant)
# ===================
QDRANT_URL=${env.QDRANT_URL || 'http://localhost:6333'}
QDRANT_API_KEY=${env.QDRANT_API_KEY || ''}
QDRANT_COLLECTION=${env.QDRANT_COLLECTION || 'docs'}
VECTOR_DIM=${env.VECTOR_DIM || '1536'}

# ===================
# LLM Configuration
# ===================
LLM_BASE_URL=${env.LLM_BASE_URL || 'https://api.openai.com/v1'}
LLM_API_KEY=${env.LLM_API_KEY || ''}
LLM_MODEL=${env.LLM_MODEL || 'gpt-4o-mini'}
LLM_MAX_TOKENS=${env.LLM_MAX_TOKENS || '4096'}

# ===================
# Embeddings Configuration
# ===================
EMBED_BASE_URL=${env.EMBED_BASE_URL || 'https://api.openai.com/v1'}
EMBED_API_KEY=${env.EMBED_API_KEY || ''}
EMBED_MODEL=${env.EMBED_MODEL || 'text-embedding-3-small'}

# ===================
# RAG Configuration
# ===================
MAX_CONTEXT_TOKENS=${env.MAX_CONTEXT_TOKENS || '4000'}
RETRIEVAL_TOP_K=${env.RETRIEVAL_TOP_K || '6'}
CHUNK_TARGET_TOKENS=${env.CHUNK_TARGET_TOKENS || '500'}
CHUNK_MAX_TOKENS=${env.CHUNK_MAX_TOKENS || '700'}
CHUNK_OVERLAP_TOKENS=${env.CHUNK_OVERLAP_TOKENS || '75'}

# ===================
# Security
# ===================
API_KEY=${env.API_KEY || ''}
ADMIN_TOKEN=${env.ADMIN_TOKEN || ''}

# ===================
# Optional
# ===================
REDIS_URL=${env.REDIS_URL || ''}
LOG_LEVEL=${env.LOG_LEVEL || 'info'}
CUSTOM_SYSTEM_PROMPT=${env.CUSTOM_SYSTEM_PROMPT || ''}

# ===================
# Discord Bot
# ===================
DISCORD_BOT_ENABLED=${env.DISCORD_BOT_ENABLED || 'false'}
DISCORD_BOT_TOKEN=${env.DISCORD_BOT_TOKEN || ''}
DISCORD_CLIENT_ID=${env.DISCORD_CLIENT_ID || ''}
DISCORD_GUILD_ID=${env.DISCORD_GUILD_ID || ''}
DISCORD_BOT_NAME=${env.DISCORD_BOT_NAME || 'Docs Bot'}
DISCORD_COMMAND_PREFIX=${env.DISCORD_COMMAND_PREFIX || '!docs'}
DISCORD_EMBED_COLOR=${env.DISCORD_EMBED_COLOR || '0x7c3aed'}
DISCORD_COOLDOWN_SECONDS=${env.DISCORD_COOLDOWN_SECONDS || '5'}
`;

  await fs.writeFile(ENV_PATH, content);
}

// Check if initial setup is needed (NO AUTH REQUIRED)
router.get('/setup-status', async (_req: Request, res: Response) => {
  try {
    const env = await parseEnvFile();
    
    // Check if setup was explicitly completed
    let setupCompleted = false;
    try {
      await fs.access(SETUP_COMPLETE_PATH);
      setupCompleted = true;
    } catch {
      // File doesn't exist, setup not completed
    }
    
    const isConfigured = setupCompleted && !!(env.LLM_API_KEY && env.EMBED_API_KEY && env.API_KEY);
    
    return res.json({
      isConfigured,
      hasLlmKey: !!env.LLM_API_KEY,
      hasEmbedKey: !!env.EMBED_API_KEY,
      hasApiKey: !!env.API_KEY,
      projectName: env.PROJECT_NAME || '',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to check setup status');
    return res.json({ isConfigured: false });
  }
});

// Get current settings (masks sensitive values)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const env = await parseEnvFile();
    
    const settings: Settings = {
      projectName: env.PROJECT_NAME || 'My Documentation',
      publicDocsBaseUrl: env.PUBLIC_DOCS_BASE_URL || 'https://docs.example.com',
      docsPath: env.DOCS_PATH || './docs',
      docsExtensions: env.DOCS_EXTENSIONS || '.md,.mdx',
      qdrantUrl: env.QDRANT_URL || 'http://localhost:6333',
      qdrantCollection: env.QDRANT_COLLECTION || 'docs',
      vectorDim: parseInt(env.VECTOR_DIM || '1536'),
      llmBaseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
      llmApiKey: env.LLM_API_KEY ? '••••••••' + env.LLM_API_KEY.slice(-4) : '',
      llmModel: env.LLM_MODEL || 'gpt-4o-mini',
      llmMaxTokens: parseInt(env.LLM_MAX_TOKENS || '4096'),
      embedBaseUrl: env.EMBED_BASE_URL || 'https://api.openai.com/v1',
      embedApiKey: env.EMBED_API_KEY ? '••••••••' + env.EMBED_API_KEY.slice(-4) : '',
      embedModel: env.EMBED_MODEL || 'text-embedding-3-small',
      maxContextTokens: parseInt(env.MAX_CONTEXT_TOKENS || '4000'),
      retrievalTopK: parseInt(env.RETRIEVAL_TOP_K || '6'),
      chunkTargetTokens: parseInt(env.CHUNK_TARGET_TOKENS || '500'),
      chunkMaxTokens: parseInt(env.CHUNK_MAX_TOKENS || '700'),
      chunkOverlapTokens: parseInt(env.CHUNK_OVERLAP_TOKENS || '75'),
      apiKey: env.API_KEY ? '••••••••' + env.API_KEY.slice(-4) : '',
      adminToken: env.ADMIN_TOKEN ? '••••••••' + env.ADMIN_TOKEN.slice(-4) : '',
      customSystemPrompt: env.CUSTOM_SYSTEM_PROMPT || '',
      // Discord Bot
      discordBotEnabled: env.DISCORD_BOT_ENABLED === 'true',
      discordBotToken: env.DISCORD_BOT_TOKEN ? '••••••••' + env.DISCORD_BOT_TOKEN.slice(-4) : '',
      discordClientId: env.DISCORD_CLIENT_ID || '',
      discordGuildId: env.DISCORD_GUILD_ID || '',
      discordBotName: env.DISCORD_BOT_NAME || 'Docs Bot',
      discordCommandPrefix: env.DISCORD_COMMAND_PREFIX || '!docs',
      discordEmbedColor: env.DISCORD_EMBED_COLOR || '0x7c3aed',
      discordCooldownSeconds: parseInt(env.DISCORD_COOLDOWN_SECONDS || '5'),
    };
    
    return res.json(settings);
  } catch (error) {
    logger.error({ error }, 'Failed to get settings');
    return res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Get actual unmasked API keys (for making API calls)
router.get('/actual-keys', async (_req: Request, res: Response) => {
  try {
    const env = await parseEnvFile();
    
    return res.json({
      llmApiKey: env.LLM_API_KEY || '',
      embedApiKey: env.EMBED_API_KEY || '',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get actual keys');
    return res.status(500).json({ error: 'Failed to get keys' });
  }
});

// Update settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const currentEnv = await parseEnvFile();
    const updates = req.body;
    
    // Map frontend fields to env vars
    const fieldMap: Record<string, string> = {
      projectName: 'PROJECT_NAME',
      publicDocsBaseUrl: 'PUBLIC_DOCS_BASE_URL',
      docsPath: 'DOCS_PATH',
      docsExtensions: 'DOCS_EXTENSIONS',
      qdrantUrl: 'QDRANT_URL',
      qdrantCollection: 'QDRANT_COLLECTION',
      vectorDim: 'VECTOR_DIM',
      llmBaseUrl: 'LLM_BASE_URL',
      llmApiKey: 'LLM_API_KEY',
      llmModel: 'LLM_MODEL',
      llmMaxTokens: 'LLM_MAX_TOKENS',
      embedBaseUrl: 'EMBED_BASE_URL',
      embedApiKey: 'EMBED_API_KEY',
      embedModel: 'EMBED_MODEL',
      maxContextTokens: 'MAX_CONTEXT_TOKENS',
      retrievalTopK: 'RETRIEVAL_TOP_K',
      chunkTargetTokens: 'CHUNK_TARGET_TOKENS',
      chunkMaxTokens: 'CHUNK_MAX_TOKENS',
      chunkOverlapTokens: 'CHUNK_OVERLAP_TOKENS',
      apiKey: 'API_KEY',
      adminToken: 'ADMIN_TOKEN',
      customSystemPrompt: 'CUSTOM_SYSTEM_PROMPT',
      // Discord Bot
      discordBotEnabled: 'DISCORD_BOT_ENABLED',
      discordBotToken: 'DISCORD_BOT_TOKEN',
      discordClientId: 'DISCORD_CLIENT_ID',
      discordGuildId: 'DISCORD_GUILD_ID',
      discordBotName: 'DISCORD_BOT_NAME',
      discordCommandPrefix: 'DISCORD_COMMAND_PREFIX',
      discordEmbedColor: 'DISCORD_EMBED_COLOR',
      discordCooldownSeconds: 'DISCORD_COOLDOWN_SECONDS',
    };
    
    for (const [field, envKey] of Object.entries(fieldMap)) {
      if (updates[field] !== undefined) {
        // Don't update masked values
        if (typeof updates[field] === 'string' && updates[field].startsWith('••••')) {
          continue;
        }
        currentEnv[envKey] = String(updates[field]);
      }
    }
    
    await writeEnvFile(currentEnv);
    
    logger.info('Settings updated');
    return res.json({ success: true, message: 'Settings saved. Restart server to apply changes.' });
  } catch (error) {
    logger.error({ error }, 'Failed to update settings');
    return res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Test API key (NO AUTH REQUIRED - used during setup)
router.post('/test-api-key', async (req: Request, res: Response) => {
  const { baseUrl, apiKey, type } = req.body;
  
  if (!baseUrl || !apiKey) {
    return res.json({ valid: false, error: 'Missing baseUrl or apiKey' });
  }
  
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    
    if (response.ok) {
      return res.json({ valid: true });
    } else {
      return res.json({ valid: false, error: `HTTP ${response.status}` });
    }
  } catch (error) {
    return res.json({ valid: false, error: 'Connection failed' });
  }
});

// Fetch available models (NO AUTH REQUIRED - used during setup)
router.post('/fetch-models', async (req: Request, res: Response) => {
  const { baseUrl, apiKey } = req.body;
  
  if (!baseUrl || !apiKey) {
    return res.json({ success: false, error: 'Missing baseUrl or apiKey' });
  }
  
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    
    if (!response.ok) {
      return res.json({ success: false, error: `HTTP ${response.status}` });
    }
    
    const data = await response.json();
    
    // OpenAI format: { data: [{ id: "model-name" }] }
    if (data.data && Array.isArray(data.data)) {
      const models = data.data.map((m: any) => m.id).sort();
      return res.json({ success: true, models });
    }
    
    return res.json({ success: false, error: 'Unexpected response format' });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch models');
    return res.json({ success: false, error: 'Connection failed' });
  }
});

// Generate secure token (NO AUTH REQUIRED - used during setup)
router.post('/generate-token', (_req: Request, res: Response) => {
  const token = crypto.randomBytes(32).toString('hex').slice(0, 32);
  return res.json({ token });
});

// Mark setup as complete (NO AUTH REQUIRED - called at end of wizard)
router.post('/complete-setup', async (_req: Request, res: Response) => {
  try {
    const dataDir = path.dirname(SETUP_COMPLETE_PATH);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(SETUP_COMPLETE_PATH, new Date().toISOString());
    logger.info('Setup marked as complete');
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to mark setup complete');
    return res.status(500).json({ error: 'Failed to complete setup' });
  }
});

// Reset setup (allows re-running wizard)
router.post('/reset-setup', async (_req: Request, res: Response) => {
  try {
    await fs.unlink(SETUP_COMPLETE_PATH).catch(() => {});
    logger.info('Setup reset');
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to reset setup');
    return res.status(500).json({ error: 'Failed to reset setup' });
  }
});

export default router;
