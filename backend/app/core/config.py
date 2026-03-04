from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="LLM Model Lab Backend", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8000, alias="PORT")

    llama_server_bin: str = Field(default="llama-server", alias="LLAMA_SERVER_BIN")
    llama_server_path: str | None = Field(default=None, alias="LLAMA_SERVER_PATH")
    llama_host: str = Field(default="127.0.0.1", alias="LLAMA_HOST")
    llama_port: int = Field(default=8081, alias="LLAMA_PORT")
    llama_default_ctx_size: int = Field(default=4096, alias="LLAMA_DEFAULT_CTX_SIZE")
    llama_default_gpu_layers: int = Field(default=-1, alias="LLAMA_DEFAULT_GPU_LAYERS")
    default_threads: int = Field(default=8, alias="DEFAULT_THREADS")
    default_ctx: int = Field(default=4096, alias="DEFAULT_CTX")
    default_gpu_layers: int = Field(default=-1, alias="DEFAULT_GPU_LAYERS")
    llama_extra_args: str = Field(default="", alias="LLAMA_EXTRA_ARGS")

    models_dir: Path = Field(default=Path("/home/mojo/llm-model-lab/models"), alias="MODELS_DIR")
    runs_dir: Path = Field(default=Path("/home/mojo/llm-model-lab/runs"), alias="RUNS_DIR")
    runs_db_path: Path = Field(default=Path("/home/mojo/llm-model-lab/runs/runs.db"), alias="RUNS_DB_PATH")

    metrics_interval_seconds: float = Field(default=1.0, alias="METRICS_INTERVAL_SECONDS")
    local_request_timeout_seconds: float = Field(default=1800.0, alias="LOCAL_REQUEST_TIMEOUT_SECONDS")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
