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

export interface ImageResult {
  url: string;
  sourceTitle: string;
  relevance?: number;
}

export interface ChatResponse {
  answer: string;
  sources: Source[];
  images?: ImageResult[];
  totalImages?: number;
  conversationId: string;
}

export interface HealthResponse {
  status: string;
  services: {
    api: string;
    qdrant: string;
  };
}

export interface MoreImagesResponse {
  images: ImageResult[];
  total: number;
  hasMore: boolean;
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
    logger.debug({ 
      answerLength: data.answer.length, 
      sourceCount: data.sources.length,
      imageCount: data.images?.length || 0,
    }, 'RAG API response received');

    return data;
  }

  async getMoreImages(conversationId: string, offset: number = 0, limit: number = 5): Promise<MoreImagesResponse> {
    const url = `${this.baseUrl}/chat/${conversationId}/images?offset=${offset}&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get more images: ${response.status}`);
    }

    return await response.json() as MoreImagesResponse;
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
