# LLM Model Lab - Handoff Notes

## Project Location
- Root: `/home/mojo/llm-model-lab`
- Backend: `/home/mojo/llm-model-lab/backend`
- Frontend: `/home/mojo/llm-model-lab/frontend`
- Models: `/home/mojo/models/qwen3.5-gguf`
- Runs/logs: `/home/mojo/llm-model-lab/runs`

## What Has Been Accomplished

### Core app scaffold
- FastAPI backend with process management for `llama-server`.
- React + Vite + TypeScript + Tailwind frontend with:
  - Chat Lab page
  - Runs page
  - Live stats panel
  - Live backend console panel

### llama-server integration
- Backend controls start/stop/warmup/status/health.
- Added Docker wrapper execution for host compatibility:
  - Script: `/home/mojo/llm-model-lab/backend/scripts/llama_server_docker.sh`
  - Uses NVIDIA CUDA container and host networking.
- `flash-attn` and mlock/mmap arg compatibility fixed for current llama-server CLI.

### Streaming + run logging
- `/api/chat` enqueues runs and streams via websocket channels.
- Run records saved in:
  - JSONL per run
  - SQLite index (`runs.db`)
- Run export endpoint returns ZIP with metadata/events/jsonl.

### Streaming reliability fixes
- Frontend no longer reconnects websocket per run.
- Added send timeout unlock and better run event handling.
- `crypto.randomUUID()` compatibility fallback implemented.
- Backend parser expanded for more SSE variants.
- Non-stream fallback implemented when stream tokens are absent.
- Reasoning output support added (`reasoning_content` handling).

### Multi-user improvements
- Session-scoped inference streaming:
  - Browser session gets persistent `session_id` in localStorage.
  - `session_id` sent in chat metadata.
  - Backend tags token/events and websocket filters by session.
- Multi-user activity/resource stats added:
  - active websocket clients
  - active runs
  - RAM available per user
  - VRAM available per user (if NVML available)

### Shared collaboration chat (new)
- Added collapsible shared lounge chat panel between main area and console.
- Backend lounge endpoints:
  - `GET /api/lounge/messages`
  - `POST /api/lounge/messages`
- Lounge messages also stream over websocket channel `lounge`.

### UX features added
- Tooltips on adjustable settings.
- Runtime dirty indicator + restart shortcut.
- Prompt history (localStorage) with load/save.
- Custom presets (save/load/delete in localStorage).
- Context usage gauge in top bar with used/total and percent.
- Console vertical size slider persisted in localStorage.
- Layout mode selector:
  - `Default`
  - `Chat Right`
  - `Console Right`
- Model dropdown severity indicators:
  - 35B red
  - 9B orange
  - 4B yellow
  - 2B and below green

## Key Files Changed Recently
- Backend:
  - `/home/mojo/llm-model-lab/backend/app/main.py`
  - `/home/mojo/llm-model-lab/backend/app/core/schemas.py`
  - `/home/mojo/llm-model-lab/backend/app/services/event_bus.py`
  - `/home/mojo/llm-model-lab/backend/app/services/chat_service.py`
  - `/home/mojo/llm-model-lab/backend/app/services/metrics.py`
  - `/home/mojo/llm-model-lab/backend/app/services/lounge.py` (new)
  - `/home/mojo/llm-model-lab/backend/app/api/lounge.py` (new)
- Frontend:
  - `/home/mojo/llm-model-lab/frontend/src/pages/ChatLabPage.tsx`
  - `/home/mojo/llm-model-lab/frontend/src/components/SettingsPanel.tsx`
  - `/home/mojo/llm-model-lab/frontend/src/components/ModelSelector.tsx`
  - `/home/mojo/llm-model-lab/frontend/src/components/StatsPanel.tsx`
  - `/home/mojo/llm-model-lab/frontend/src/components/ConsolePanel.tsx`
  - `/home/mojo/llm-model-lab/frontend/src/components/LoungePanel.tsx` (new)
  - `/home/mojo/llm-model-lab/frontend/src/lib/api.ts`
  - `/home/mojo/llm-model-lab/frontend/src/lib/ws.ts`
  - `/home/mojo/llm-model-lab/frontend/src/lib/types.ts`

## Runtime/Environment Notes
- LAN URL used: `http://10.90.98.20:5173`
- Tailscale IP seen previously: `100.121.93.91`
- Docker is installed and used to launch GPU llama-server.
- A sudoers rule was added for passwordless docker command execution by user `mojo`.

## Verified Status (at handoff time)
- Backend compile succeeds: `python3 -m compileall /home/mojo/llm-model-lab/backend/app`
- Frontend build succeeds: `npm run build` in `/home/mojo/llm-model-lab/frontend`

## Known Caveats / Technical Debt
- `console-right` layout mode is implemented, but layout composition is still mode-based (not free drag/drop docking).
- Websocket filtering is session-aware for `tokens/events`, while `console/stats/lounge` remain globally visible by design.
- Server control is still shared; any user can start/stop unless role-based control is added.

## Recommended Next Steps for Next Agent
1. Add admin/owner lock for server controls (start/stop/restart only for authorized session).
2. Add users-online list in lounge (presence channel / heartbeat).
3. Add per-session console filter option (global vs local only).
4. Add true draggable docking/resizable split panes for Chat/Stats/Console/Lounge.
5. Improve model dropdown styling for option colors across browsers (native select styling can vary).
6. Add integration tests for websocket session filtering and lounge message broadcast.
7. Update README with latest lounge/multi-user/layout features.

## Quick Resume Commands
- Backend dev:
  - `cd /home/mojo/llm-model-lab/backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
- Frontend dev:
  - `cd /home/mojo/llm-model-lab/frontend && npm run dev -- --host 0.0.0.0 --port 5173`
- Combined helper:
  - `cd /home/mojo/llm-model-lab && ./scripts/dev.sh`
