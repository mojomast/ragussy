from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    id: str
    name: str
    path: str
    size_bytes: int
    modified_at: datetime
    hash16mb: str
    suggested_ctx: int | None = None


class ModelListResponse(BaseModel):
    models: list[ModelInfo]


class ServerStartRequest(BaseModel):
    model_path: str = Field(description="Absolute path to a .gguf model")
    port: int | None = None
    ctx_size: int | None = None
    threads: int | None = None
    gpu_layers: int | None = None
    batch_size: int | None = None
    ubatch_size: int | None = None
    flash_attention: bool | None = None
    mmap: bool | None = None
    mlock: bool | None = None
    multi_instance_mode: bool = False
    extra_args: list[str] = Field(default_factory=list)


class ServerStatusResponse(BaseModel):
    running: bool
    pid: int | None = None
    model_path: str | None = None
    host: str
    port: int
    started_at: datetime | None = None
    command: list[str] = Field(default_factory=list)


class ServerActionResponse(BaseModel):
    ok: bool
    message: str
    status: ServerStatusResponse


class WarmupRequest(BaseModel):
    prompt: str = "Hello"
    max_tokens: int = 8


class WarmupResponse(BaseModel):
    ok: bool
    latency_ms: float
    model: str | None = None


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    name: str | None = None


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage]
    system_prompt: str | None = None
    temperature: float | None = 0.7
    top_p: float | None = 1.0
    top_k: int | None = None
    min_p: float | None = None
    repeat_penalty: float | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    seed: int | None = None
    max_tokens: int | None = 512
    stop: list[str] | None = None
    stream: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatStartResponse(BaseModel):
    run_id: str
    status: Literal["queued", "running"]


class RunSummary(BaseModel):
    run_id: str
    created_at: datetime
    updated_at: datetime
    status: str
    model: str | None = None
    ttft_ms: float | None = None
    total_time_ms: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    tokens_per_s: float | None = None
    error: str | None = None


class RunDetail(RunSummary):
    request_messages: list[dict[str, Any]]
    settings: dict[str, Any]
    resources: dict[str, Any]


class RunListResponse(BaseModel):
    runs: list[RunSummary]


class WSStreamMessage(BaseModel):
    channel: Literal["tokens", "stats", "console", "events", "lounge"]
    timestamp: datetime
    payload: dict[str, Any]


class LoungeMessage(BaseModel):
    id: str
    timestamp: datetime
    session_id: str
    alias: str
    text: str


class LoungePostRequest(BaseModel):
    session_id: str
    alias: str | None = None
    text: str


class LoungeListResponse(BaseModel):
    messages: list[LoungeMessage]


class FrontendConfigResponse(BaseModel):
    ragussy_admin_url: str
    ragussy_base_url: str
    ragussy_enabled: bool


class RagussyChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None


class RagussyChatResponse(BaseModel):
    answer: str
    conversation_id: str | None = None


class RagussyHealthResponse(BaseModel):
    reachable: bool
    configured: bool
    base_url: str
    status_code: int | None = None
    details: dict[str, Any] | None = None
