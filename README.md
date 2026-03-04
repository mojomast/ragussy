# LLM Model Lab

Local web lab for testing and comparing `llama.cpp` GGUF models with a FastAPI backend and React frontend.

## What You Get

- Model discovery from a local models folder (`*.gguf`)
- Start/stop/warmup `llama-server` from UI
- Chat UI with granular sampling controls and presets
- Live telemetry (CPU/RAM/llama RSS + optional NVIDIA GPU via NVML)
- Live backend console stream (server stdout/stderr + backend events)
- Run logging:
  - JSONL event stream per run (`runs/<run_id>.jsonl`)
  - SQLite run index (`runs/runs.db`)
- Runs page with side-by-side compare view
- Export run as ZIP (`metadata.json` + `events.json`)

## Assumptions

- OS: Linux preferred. Windows users should run inside WSL2.
- Hardware: 16GB+ RAM. NVIDIA GPU optional (24GB VRAM recommended for larger offload).
- `llama.cpp` is already compiled and `llama-server` is available.
- If using NVIDIA offload, `llama.cpp` should be built with CUDA enabled.

## Repository Structure

- `backend/` FastAPI app, process manager, logging, metrics
- `frontend/` React + Vite + TypeScript + Tailwind UI
- `models/` local GGUF files
- `runs/` run JSONL + SQLite index
- `scripts/dev.sh` convenience dev launcher
- `docker-compose.yml` optional containerized run

## Backend API

- `GET /health`
- `GET /api/models`
- `POST /api/server/start`
- `POST /api/server/stop`
- `GET /api/server/status`
- `GET /api/server/health`
- `POST /api/server/warmup`
- `POST /api/chat`
- `GET /api/config`
- `GET /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/export`
- `GET /v1/models` (OpenAI-compatible, requires Bearer auth)
- `POST /v1/chat/completions` (OpenAI-compatible, requires Bearer auth)
- `POST /v1/embeddings` (OpenAI-compatible, requires Bearer auth)
- `WS /ws/stream` channels: `tokens`, `stats`, `console`, `events`

## Environment

Copy `backend/.env.example` to `backend/.env` and update values.

Important keys:

- `MODELS_DIR`
- `LLAMA_SERVER_PATH`
- `LLAMA_SERVER_PORT` (uses `LLAMA_PORT` in backend config)
- `DEFAULT_THREADS`
- `DEFAULT_CTX`
- `DEFAULT_GPU_LAYERS`
- `MODEL_LAB_OPENAI_API_KEY`
- `EMBED_MODE` (`local`)
- `EMBED_MODEL` (`bge-m3`)
- `EMBED_DIM` (`1024`)
- `RAGUSSY_ADMIN_URL`

## Full Local Stack (Model Lab + Ragussy)

This setup runs fully local inference and embeddings through Model Lab, with Ragussy consuming Model Lab as an OpenAI-compatible provider.

Flow:

User -> Model Lab -> llama.cpp + BGE-M3 -> Ragussy

### Ragussy control from Model Lab

Model Lab now includes:

- `Ragussy Admin` top-nav button (configured by `RAGUSSY_ADMIN_URL`)
- Chat provider selector in Chat Lab:
  - `Local llama.cpp`
  - `Ragussy RAG`
  - `Ragussy Direct`
- Ragussy reachability status in the Chat Lab top row
- Backend proxy endpoints:
  - `GET /api/ragussy/health`
  - `POST /api/ragussy/chat` (RAG)
  - `POST /api/ragussy/direct` (Direct)

To enable proxy mode, set in `backend/.env`:

```env
RAGUSSY_BASE_URL=http://localhost:3001
RAGUSSY_API_KEY=<RAGUSSY_API_KEY>
RAGUSSY_ADMIN_URL=http://localhost:5173
```

### 1) Start llama.cpp server (managed by Model Lab)

Use the Model Lab UI or API to start your selected GGUF model.

### 2) Start LLM Model Lab backend/frontend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

### 3) Start Qdrant

```bash
docker run -p 6333:6333 qdrant/qdrant
```

### 4) Start Ragussy

Configure Ragussy `.env`:

```env
LLM_BASE_URL=http://localhost:8000/v1
LLM_API_KEY=<MODEL_LAB_OPENAI_API_KEY>
LLM_MODEL=local-model

EMBED_BASE_URL=http://localhost:8000/v1
EMBED_API_KEY=<MODEL_LAB_OPENAI_API_KEY>
EMBED_MODEL=bge-m3
VECTOR_DIM=1024
```

Then run Ragussy normally.

## Embeddings vs llama.cpp

`bge-m3` is not loaded into `llama.cpp` in this stack.

- `llama.cpp` handles chat generation (GGUF model inference)
- Model Lab embedding endpoint (`POST /v1/embeddings`) runs BGE-M3 through Python (`FlagEmbedding`)
- Ragussy consumes both through Model Lab's OpenAI-compatible API

In other words: embeddings are a separate service path, not a llama.cpp runtime feature in this integration.

If you want llama.cpp-native embeddings in the future, use an embedding-capable GGUF model and add a dedicated `EMBED_MODE` path for llama.cpp embedding calls.

## OpenAI Compatibility Verification

### Check available model

```bash
curl -H "Authorization: Bearer <KEY>" \
  http://localhost:8000/v1/models
```

### Test chat completion

```bash
curl -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/chat/completions \
  -d '{
    "model": "local-model",
    "messages": [{"role": "user", "content": "Say hello"}],
    "stream": false
  }'
```

### Test embeddings (BGE-M3, 1024 dim)

```bash
curl -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/embeddings \
  -d '{"model":"bge-m3","input":"hello world"}'
```

### Test hybrid embeddings (dense + sparse for Ragussy)

```bash
curl -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/v1/embeddings \
  -d '{"model":"bge-m3","input":"hello world","ragussy_return_sparse":true}'
```

Response includes each embedding item plus:

- `sparse.indices` (int array)
- `sparse.values` (float array)

## Local Development

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default: `http://localhost:5173`  
Backend default: `http://localhost:8000`

## LAN + Tailscale Access

This project is configured for remote access in dev mode:

- Backend binds to `0.0.0.0:8000`
- Frontend Vite binds to `0.0.0.0:5173`
- Frontend proxies `/api` and `/ws` to backend, so remote browsers work without `localhost` issues

Your detected Tailscale IPv4 on this machine:

- `100.121.93.91`

From another device on your tailnet, open:

- `http://100.121.93.91:5173`

From another device on your LAN, open:

- `http://<LAN-IP>:5173`

Find LAN IP quickly:

```bash
ip -4 -br addr
```

If you use a firewall, allow ports `5173` and `8000` (UFW is currently inactive on this host).

### One-command dev helper

```bash
./scripts/dev.sh
```

## Production Options

### Option A: frontend build + backend serving API only

```bash
cd frontend && npm install && npm run build
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Option B: docker-compose

```bash
docker compose up --build
```

## CUDA vs CPU Notes

- CUDA build required for meaningful GPU offload:
  - compile `llama.cpp` with `-DGGML_CUDA=ON`
- CPU-only still works, but latency and throughput are significantly lower.
- In UI, set `gpu_layers` high (e.g. `99`) to offload as much as possible.

## Troubleshooting

- **Model list empty**
  - Verify `MODELS_DIR` points to folder containing `*.gguf`
- **Server start fails: model not found**
  - Use absolute model path; ensure readable file permissions
- **Port already in use**
  - Change start payload `port` or stop existing process on that port
- **GPU stats unavailable**
  - Install `pynvml` and NVIDIA drivers; if absent, backend reports unavailable
- **No streamed tokens in UI**
  - Check `WS /ws/stream` connectivity and backend console panel

## Minimal Test Plan

1. Start backend + frontend.
2. Verify `GET /api/models` returns GGUF files.
3. Start `llama-server` from UI using one model.
4. Run warmup; verify latency event in console.
5. Send chat prompt; verify streamed tokens in transcript.
6. Open Runs page; verify run appears with TTFT/tokens/s.
7. Select 2 runs and compare side-by-side.
8. Export one run and inspect ZIP content.

## Smoke Test Script

```bash
backend/scripts/smoke_test.sh /absolute/path/to/model.gguf
```

## Notes on Unsupported Settings

Some sampler fields (for example `min_p`, penalties, or stop behavior) may vary by `llama-server` version/build flags. The UI still exposes controls; unsupported options may be ignored by the backend server.
