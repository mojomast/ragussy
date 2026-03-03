import { env, logger } from '../config/index.js';
import type { SummaryStyle } from './conversion-intent.js';
import type { ConversionIntent } from './conversion-intent.js';

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

export interface UploadDocumentResponse {
  success: boolean;
  filesAdded: number;
  files: string[];
  skippedFiles?: string[];
  renamedFiles?: Array<{ from: string; to: string }>;
}

export type ConflictStrategy = 'replace' | 'rename' | 'skip';

export interface ConvertUploadResponse {
  success: boolean;
  conflictStrategy: ConflictStrategy;
  filesAdded: number;
  files: string[];
  skippedFiles?: string[];
  renamedFiles?: Array<{ from: string; to: string }>;
  conversion: {
    sourceFormat: string;
    appliedActions: string[];
    warnings: string[];
    ignoredInstructions: string[];
    markdownLength: number;
  };
  ingestion?: {
    filesScanned: number;
    filesUpdated: number;
    filesDeleted: number;
    chunksUpserted: number;
    chunksDeleted: number;
    errors: string[];
  } | null;
}

export interface IngestDocumentsResponse {
  success: boolean;
  result?: {
    filesScanned: number;
    filesUpdated: number;
    filesDeleted: number;
    chunksUpserted: number;
    chunksDeleted: number;
    errors: string[];
  };
}

export class RagApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || env.RAG_API_URL;
    this.apiKey = apiKey || env.RAG_API_KEY;
  }

  async chat(request: ChatRequest, timeoutMs?: number): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat`;

    logger.debug({ url, message: request.message.slice(0, 100) }, 'Calling RAG API');

    const response = await this.fetchWithOptionalTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(request),
      },
      timeoutMs
    );

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

  async uploadDocument(
    fileName: string,
    markdown: string,
    conflictStrategy: ConflictStrategy = 'replace'
  ): Promise<UploadDocumentResponse> {
    const url = `${this.baseUrl}/documents/upload`;

    const formData = new FormData();
    const blob = new Blob([markdown], { type: 'text/markdown; charset=utf-8' });
    formData.append('file', blob, fileName);
    formData.append('conflictStrategy', conflictStrategy);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Document upload failed');
      throw new Error(`Document upload failed: ${response.status} ${response.statusText}`);
    }

    return await response.json() as UploadDocumentResponse;
  }

  async ingestDocuments(selectedFiles?: string[]): Promise<IngestDocumentsResponse> {
    const url = `${this.baseUrl}/documents/ingest`;
    const body = selectedFiles && selectedFiles.length > 0
      ? { selectedFiles }
      : {};

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Document ingestion trigger failed');
      throw new Error(`Document ingestion failed: ${response.status} ${response.statusText}`);
    }

    return await response.json() as IngestDocumentsResponse;
  }

  async convertUpload(params: {
    fileName: string;
    mimeType?: string | null;
    bytes: Uint8Array;
    conflictStrategy?: ConflictStrategy;
    ingestNow?: boolean;
    intent?: ConversionIntent;
  }): Promise<ConvertUploadResponse> {
    const url = `${this.baseUrl}/documents/convert-upload`;

    const formData = new FormData();
    const blob = new Blob([params.bytes], { type: params.mimeType || 'application/octet-stream' });
    formData.append('file', blob, params.fileName);
    formData.append('conflictStrategy', params.conflictStrategy ?? 'replace');
    formData.append('ingestNow', String(params.ingestNow ?? true));
    formData.append('intent', JSON.stringify(params.intent ?? { operation: 'convert' }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Convert-upload request failed');
      throw new Error(`Convert upload failed: ${response.status} ${response.statusText}`);
    }

    return await response.json() as ConvertUploadResponse;
  }

  async summarizeMarkdown(
    markdown: string,
    style: SummaryStyle = 'short',
    timeoutMs = 12000
  ): Promise<string> {
    const maxInputChars = 14000;
    const truncated = markdown.length > maxInputChars
      ? `${markdown.slice(0, maxInputChars)}\n\n[truncated for summarization]`
      : markdown;

    const styleInstruction = style === 'bullets'
      ? 'Return a concise bullet list with key points.'
      : style === 'detailed'
        ? 'Return a detailed multi-paragraph summary.'
        : 'Return a brief summary in 3-5 sentences.';

    const message = [
      'Summarize the following markdown content.',
      styleInstruction,
      'Do not invent facts, and do not add source links.',
      'Return markdown only.',
      '',
      '--- BEGIN CONTENT ---',
      truncated,
      '--- END CONTENT ---',
    ].join('\n');

    const response = await this.chat({ message }, timeoutMs);
    return response.answer.trim();
  }

  private async fetchWithOptionalTimeout(
    url: string,
    init: RequestInit,
    timeoutMs?: number
  ): Promise<Response> {
    if (!timeoutMs || timeoutMs <= 0) {
      return fetch(url, init);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const ragApi = new RagApiClient();
