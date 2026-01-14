import { ChatOpenAI } from '@langchain/openai';
import { env, logger, getSystemPrompt } from '../config/index.js';

let chatModel: ChatOpenAI | null = null;

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
  const response = await fetch(`${env.EMBED_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.EMBED_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.EMBED_MODEL,
      input: texts,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Embedding API request failed');
    throw new Error(`Embedding API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const observedDim = data.data[0]?.embedding?.length;
  
  logger.info({ model: env.EMBED_MODEL, count: texts.length, dimension: observedDim }, 'Embeddings generated');

  // Validate embedding dimension matches configuration
  if (observedDim !== env.VECTOR_DIM) {
    throw new Error(
      `Embedding dimension mismatch: observed ${observedDim}, expected ${env.VECTOR_DIM}. ` +
      'Update VECTOR_DIM in your .env file to match your embedding model.'
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
