import { env, logger } from '../config/index.js';

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface Source {
  title: string;
  url: string;
  section?: string;
  relevance?: number;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  conversationId: string;
}

export interface HealthResponse {
  status: string;
  services: {
    api: string;
    qdrant: string;
  };
}

export class RagApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || env.RAG_API_URL;
    this.apiKey = apiKey || env.RAG_API_KEY;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat`;
    
    logger.debug({ url, message: request.message.slice(0, 100) }, 'Calling RAG API');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'RAG API request failed');
      throw new Error(`RAG API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as ChatResponse;
    logger.debug({ answerLength: data.answer.length, sourceCount: data.sources.length }, 'RAG API response received');

    return data;
  }

  async health(): Promise<HealthResponse> {
    const url = `${this.baseUrl}/health`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return await response.json() as HealthResponse;
  }
}

export const ragApi = new RagApiClient();
