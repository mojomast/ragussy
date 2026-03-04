export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

export interface SamplingSettings {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  repeat_penalty: number;
  presence_penalty: number;
  frequency_penalty: number;
  seed: number | null;
  max_tokens: number;
  stop_sequences: string[];
}

export interface ModelInfo {
  id: string;
  name: string;
  path: string;
  size_bytes: number;
  modified_at: string;
  hash16mb: string;
  suggested_ctx?: number | null;
}

export interface ServerStartPayload {
  model_path: string;
  port?: number;
  ctx_size?: number;
  threads?: number;
  gpu_layers?: number;
  batch_size?: number;
  ubatch_size?: number;
  flash_attention?: boolean;
  mmap?: boolean;
  mlock?: boolean;
  multi_instance_mode?: boolean;
  extra_args?: string[];
}

export interface RunSummary {
  run_id: string;
  created_at: string;
  updated_at: string;
  status: string;
  model?: string;
  ttft_ms?: number;
  total_time_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  tokens_per_s?: number;
  error?: string;
}

export interface RunDetail extends RunSummary {
  request_messages: Array<{ role: string; content: string }>;
  settings: Record<string, unknown>;
  resources: Record<string, unknown>;
}

export interface ChatRequest {
  model?: string;
  system_prompt?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number | null;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ChatStartResponse {
  run_id: string;
  status: "queued" | "running";
}

export interface WsMessage {
  channel: "tokens" | "stats" | "console" | "events" | "lounge";
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface LoungeMessage {
  id: string;
  timestamp: string;
  session_id: string;
  alias: string;
  text: string;
}

export interface FrontendConfig {
  ragussy_admin_url: string;
  ragussy_base_url: string;
  ragussy_enabled: boolean;
}

export type ChatProvider = "local" | "ragussy-rag" | "ragussy-direct";
