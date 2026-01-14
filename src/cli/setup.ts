#!/usr/bin/env node
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

interface SetupConfig {
  projectName: string;
  docsPath: string;
  docsBaseUrl: string;
  qdrantUrl: string;
  qdrantCollection: string;
  llmProvider: 'openai' | 'openrouter' | 'custom';
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  embedProvider: 'same' | 'openai' | 'custom';
  embedBaseUrl: string;
  embedApiKey: string;
  embedModel: string;
  vectorDim: number;
}

function generateSecureToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

async function checkQdrantConnection(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/collections`);
    return response.ok;
  } catch {
    return false;
  }
}

async function checkApiKey(baseUrl: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log(chalk.cyan.bold('\n🚀 DocuRAG Setup Wizard\n'));
  console.log(chalk.gray('This wizard will help you configure your RAG chatbot.\n'));

  // Project Identity
  console.log(chalk.yellow.bold('📋 Project Configuration\n'));
  
  const projectAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'What is your project/documentation name?',
      default: 'My Documentation',
      validate: (input: string) => input.length > 0 || 'Project name is required',
    },
    {
      type: 'input',
      name: 'docsPath',
      message: 'Path to your documentation directory:',
      default: './docs',
      validate: async (input: string) => {
        try {
          const stats = await fs.stat(input);
          return stats.isDirectory() || 'Path must be a directory';
        } catch {
          return 'Directory does not exist. Create it first or provide a valid path.';
        }
      },
    },
    {
      type: 'input',
      name: 'docsBaseUrl',
      message: 'Public URL where your docs are hosted:',
      default: 'https://docs.example.com',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
  ]);

  // Vector Database
  console.log(chalk.yellow.bold('\n🗄️  Vector Database (Qdrant)\n'));
  
  const qdrantAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'qdrantUrl',
      message: 'Qdrant URL:',
      default: 'http://localhost:6333',
    },
    {
      type: 'input',
      name: 'qdrantCollection',
      message: 'Collection name:',
      default: 'docs',
    },
  ]);

  // Test Qdrant connection
  const qdrantSpinner = ora('Testing Qdrant connection...').start();
  const qdrantOk = await checkQdrantConnection(qdrantAnswers.qdrantUrl);
  if (qdrantOk) {
    qdrantSpinner.succeed('Qdrant connection successful');
  } else {
    qdrantSpinner.warn('Could not connect to Qdrant. Make sure it\'s running before starting the server.');
  }

  // LLM Configuration
  console.log(chalk.yellow.bold('\n🤖 LLM Configuration\n'));
  
  const llmProviderAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'llmProvider',
      message: 'Select your LLM provider:',
      choices: [
        { name: 'OpenAI', value: 'openai' },
        { name: 'OpenRouter', value: 'openrouter' },
        { name: 'Custom (OpenAI-compatible)', value: 'custom' },
      ],
    },
  ]);

  let llmBaseUrl = 'https://api.openai.com/v1';
  let defaultModel = 'gpt-4o-mini';

  if (llmProviderAnswer.llmProvider === 'openrouter') {
    llmBaseUrl = 'https://openrouter.ai/api/v1';
    defaultModel = 'openai/gpt-4o-mini';
  } else if (llmProviderAnswer.llmProvider === 'custom') {
    const customUrl = await inquirer.prompt([
      {
        type: 'input',
        name: 'llmBaseUrl',
        message: 'Custom LLM API base URL:',
        default: 'https://api.openai.com/v1',
      },
    ]);
    llmBaseUrl = customUrl.llmBaseUrl;
  }

  const llmAnswers = await inquirer.prompt([
    {
      type: 'password',
      name: 'llmApiKey',
      message: 'LLM API Key:',
      mask: '*',
      validate: (input: string) => input.length > 0 || 'API key is required',
    },
    {
      type: 'input',
      name: 'llmModel',
      message: 'LLM Model:',
      default: defaultModel,
    },
  ]);

  // Test LLM API key
  const llmSpinner = ora('Validating LLM API key...').start();
  const llmOk = await checkApiKey(llmBaseUrl, llmAnswers.llmApiKey);
  if (llmOk) {
    llmSpinner.succeed('LLM API key validated');
  } else {
    llmSpinner.warn('Could not validate API key. Please verify it\'s correct.');
  }

  // Embeddings Configuration
  console.log(chalk.yellow.bold('\n📊 Embeddings Configuration\n'));
  
  const embedProviderAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'embedProvider',
      message: 'Embeddings provider:',
      choices: [
        { name: 'Same as LLM provider', value: 'same' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Custom (OpenAI-compatible)', value: 'custom' },
      ],
    },
  ]);

  let embedBaseUrl = llmBaseUrl;
  let embedApiKey = llmAnswers.llmApiKey;
  let defaultEmbedModel = 'text-embedding-3-small';
  let defaultVectorDim = 1536;

  if (embedProviderAnswer.embedProvider === 'openai') {
    embedBaseUrl = 'https://api.openai.com/v1';
  } else if (embedProviderAnswer.embedProvider === 'custom') {
    const customEmbed = await inquirer.prompt([
      {
        type: 'input',
        name: 'embedBaseUrl',
        message: 'Custom embeddings API base URL:',
        default: 'https://api.openai.com/v1',
      },
    ]);
    embedBaseUrl = customEmbed.embedBaseUrl;
  }

  if (embedProviderAnswer.embedProvider !== 'same') {
    const embedKeyAnswer = await inquirer.prompt([
      {
        type: 'password',
        name: 'embedApiKey',
        message: 'Embeddings API Key:',
        mask: '*',
        validate: (input: string) => input.length > 0 || 'API key is required',
      },
    ]);
    embedApiKey = embedKeyAnswer.embedApiKey;
  }

  const embedModelAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'embedModel',
      message: 'Embedding model:',
      choices: [
        { name: 'text-embedding-3-small (1536 dims, fast)', value: 'text-embedding-3-small' },
        { name: 'text-embedding-3-large (3072 dims, better quality)', value: 'text-embedding-3-large' },
        { name: 'text-embedding-ada-002 (1536 dims, legacy)', value: 'text-embedding-ada-002' },
        { name: 'Custom model', value: 'custom' },
      ],
    },
  ]);

  let embedModel = embedModelAnswer.embedModel;
  let vectorDim = 1536;

  if (embedModel === 'text-embedding-3-large') {
    vectorDim = 3072;
  } else if (embedModel === 'custom') {
    const customModel = await inquirer.prompt([
      {
        type: 'input',
        name: 'embedModel',
        message: 'Custom embedding model name:',
      },
      {
        type: 'number',
        name: 'vectorDim',
        message: 'Vector dimension:',
        default: 1536,
      },
    ]);
    embedModel = customModel.embedModel;
    vectorDim = customModel.vectorDim;
  }

  // Generate secure tokens
  console.log(chalk.yellow.bold('\n🔐 Security Configuration\n'));
  
  const apiKey = generateSecureToken(32);
  const adminToken = generateSecureToken(32);

  console.log(chalk.gray('Generated secure API key and admin token.\n'));

  // Build .env content
  const envContent = `# DocuRAG Configuration
# Generated by setup wizard on ${new Date().toISOString()}

# ===================
# Server Configuration
# ===================
PORT=3001
NODE_ENV=development

# ===================
# Project Identity
# ===================
PROJECT_NAME=${projectAnswers.projectName}
PUBLIC_DOCS_BASE_URL=${projectAnswers.docsBaseUrl}

# ===================
# Document Source
# ===================
DOCS_PATH=${projectAnswers.docsPath}
DOCS_EXTENSIONS=.md,.mdx

# ===================
# Vector Database (Qdrant)
# ===================
QDRANT_URL=${qdrantAnswers.qdrantUrl}
QDRANT_API_KEY=
QDRANT_COLLECTION=${qdrantAnswers.qdrantCollection}
VECTOR_DIM=${vectorDim}

# ===================
# LLM Configuration
# ===================
LLM_BASE_URL=${llmBaseUrl}
LLM_API_KEY=${llmAnswers.llmApiKey}
LLM_MODEL=${llmAnswers.llmModel}
LLM_MAX_TOKENS=4096

# ===================
# Embeddings Configuration
# ===================
EMBED_BASE_URL=${embedBaseUrl}
EMBED_API_KEY=${embedApiKey}
EMBED_MODEL=${embedModel}

# ===================
# RAG Configuration
# ===================
MAX_CONTEXT_TOKENS=4000
RETRIEVAL_TOP_K=6
CHUNK_TARGET_TOKENS=500
CHUNK_MAX_TOKENS=700
CHUNK_OVERLAP_TOKENS=75

# ===================
# Security
# ===================
API_KEY=${apiKey}
ADMIN_TOKEN=${adminToken}

# ===================
# Optional Features
# ===================
REDIS_URL=
LOG_LEVEL=info
`;

  // Write .env file
  const envPath = path.join(process.cwd(), '.env');
  await fs.writeFile(envPath, envContent);

  console.log(chalk.green.bold('\n✅ Configuration saved to .env\n'));

  // Summary
  console.log(chalk.cyan.bold('📋 Configuration Summary:\n'));
  console.log(`   Project:     ${chalk.white(projectAnswers.projectName)}`);
  console.log(`   Docs Path:   ${chalk.white(projectAnswers.docsPath)}`);
  console.log(`   Docs URL:    ${chalk.white(projectAnswers.docsBaseUrl)}`);
  console.log(`   Qdrant:      ${chalk.white(qdrantAnswers.qdrantUrl)}`);
  console.log(`   Collection:  ${chalk.white(qdrantAnswers.qdrantCollection)}`);
  console.log(`   LLM Model:   ${chalk.white(llmAnswers.llmModel)}`);
  console.log(`   Embed Model: ${chalk.white(embedModel)}`);
  console.log(`   Vector Dim:  ${chalk.white(vectorDim.toString())}`);

  console.log(chalk.cyan.bold('\n🔐 Security Tokens:\n'));
  console.log(`   API Key:     ${chalk.gray(apiKey.slice(0, 8) + '...')}`);
  console.log(`   Admin Token: ${chalk.gray(adminToken.slice(0, 8) + '...')}`);

  console.log(chalk.yellow.bold('\n📝 Next Steps:\n'));
  console.log('   1. Start Qdrant (if not running):');
  console.log(chalk.gray('      docker run -p 6333:6333 qdrant/qdrant\n'));
  console.log('   2. Install dependencies:');
  console.log(chalk.gray('      npm install\n'));
  console.log('   3. Ingest your documents:');
  console.log(chalk.gray('      npm run ingest\n'));
  console.log('   4. Start the server:');
  console.log(chalk.gray('      npm run dev\n'));
  console.log('   5. Test the API:');
  console.log(chalk.gray(`      curl -X POST http://localhost:3001/api/chat \\`));
  console.log(chalk.gray(`        -H "Content-Type: application/json" \\`));
  console.log(chalk.gray(`        -H "x-api-key: ${apiKey}" \\`));
  console.log(chalk.gray(`        -d '{"message": "Hello!"}'`));

  console.log('');
}

main().catch(console.error);
