# Document Conversion Roadmap

This roadmap starts with Discord ingestion workflows and then expands to the web UI.

## Current State (implemented)

- Discord bot supports `/adddoc` to upload a file, convert to markdown, store in docs, and optionally trigger selective ingestion.
- Discord bot supports `/convertdoc` for instruction-driven conversion before upload/optional ingest.
- Supported inputs in bot conversion path:
  - Markdown (`.md`, `.mdx`, `.markdown`)
  - Plain text-ish files (`.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.xml`, `.yaml`, `.yml`, `.rst`, `.adoc`)
  - HTML (`.html`, `.htm`)
  - DOCX (`.docx`)
  - PDF (`.pdf`, text extraction)
- `/adddoc` and `/convertdoc` are restricted to `Manage Server` and disabled in DMs.
- Intent parser is in place for `/convertdoc` with deterministic rules and LLM fallback.
- Conversion post-processing is implemented:
  - summarize
  - extract sections
  - clean markdown
  - strip boilerplate
  - preserve/remove links
  - preserve/remove tables
- Conversion hardening is in place:
  - attachment download timeout
  - upload size checks before and after download
  - executable/binary blocklist
  - MIME/extension mismatch checks
- Duplicate handling strategy is implemented in upload workflows (`replace`, `rename`, `skip`).
- `/docpreview` is implemented to inspect converted markdown before upload/ingest.
- Basic tests exist for parser/converter/command happy paths.

## Why `convert` is a Phase-2 integration

`p2r3/convert` has strong format coverage, but its conversion runtime is browser-oriented:

- Core conversion flow in `convert` is built around browser handlers and browser WASI shims.
- The Pandoc path uses `@bjorn3/browser_wasi_shim` and fetches `pandoc.wasm` through browser paths.

For Ragussy backend/bot use, this means we should first ship practical Node-native converters (done), then integrate `convert` handlers through a dedicated server-side adapter.

## Phase 1: Hardening Discord ingestion

Status: **mostly complete**

1. ✅ Add conversion telemetry to bot logs (source format, conversion duration, warning counts).
2. ✅ Add duplicate handling strategy (`replace`, `rename`, `skip`) exposed as command options.
3. ✅ Add post-upload preview command (`/docpreview`) to inspect extracted markdown before ingest.
4. ⏳ Add OCR fallback for scanned PDFs.

## Phase 2: Shared conversion service in backend

Status: **implemented (initial)**

1. ✅ Move conversion logic from bot into a backend service module (`src/services/document-conversion.ts`).
2. ✅ Add endpoint:
   - `POST /api/documents/convert-upload` (multipart + conversion + optional ingest)
3. ✅ Keep Discord bot thin by delegating conversion to backend endpoint.
4. ✅ Add conversion metadata persistence (source MIME, converter used, warning list, checksum).

Current implementation notes:

- Conversion metadata is persisted in `data/conversion-metadata.json`.
- Metadata includes source MIME, source format, applied actions, warnings, ignored instructions, SHA-256 checksum, and conversion timestamp.
- Metadata lookup endpoint is available at `GET /api/documents/conversion-metadata/*`.

## Phase 3: Integrate `convert` as an optional engine

Status: **not started**

1. Add converter-engine abstraction:
   - `node-native` (default)
   - `convert-wasm` (opt-in)
2. Build a server adapter for selected `convert` handlers (starting with pandoc-centric document formats).
3. Add feature flag in settings to choose engine per format class.
4. Add conversion compatibility matrix in docs and settings UI.

## Phase 4: Web frontend rollout

Status: **not started**

1. Add "Convert on upload" toggle to Documents page.
2. Add supported-format badges and max-size hints in uploader UX.
3. Show conversion report panel after upload:
   - extracted title
   - converter used
   - warnings
   - ingest result
4. Add retry action for failed conversions and save raw file for later reprocessing.
5. Add bulk zip conversion mode with per-file status table.

## Phase 5: Reliability and quality

Status: **partially started**

1. ⏳ Snapshot tests for deterministic conversion output (docx/html/pdf fixtures).
2. ⏳ Queue-based background ingestion for larger files.
3. ⏳ Metrics dashboard for conversion success/failure rates and latency by format.
4. 🔄 Security pass:
   - ✅ stricter write-path auth in bot command workflows
   - ✅ file-type and MIME sanity checks in bot converter path
   - ✅ zip bomb protection in backend upload pipeline (entry count and uncompressed-size guards)
   - ⏳ stricter auth coverage for backend write routes (`/api/documents`, `/api/vectors`, `/api/settings`)

## Recommended Next Slice

To maximize impact quickly, the next implementation slice should be:

1. Phase 2 items 1-3 (shared backend conversion service + `convert-upload` endpoint + bot delegation).
2. Phase 1 item 4 (OCR fallback for scanned PDFs).
3. Phase 5 security remaining items (backend route auth coverage + zip upload hardening).
