# Ingestion Pipeline Optimization Summary

## Original Bottleneck

The `BoundedQueue.processNext()` was called sequentially after each item completed, meaning even with 4 configured threads, only 1-2 requests were ever truly in-flight.

## Fixes Implemented

1. **True Worker Pool** - Replaced sequential queue with `WorkerPool` that spawns independent concurrent workers
2. **Batched I/O** - Progress and state writes batched (time + count thresholds) instead of per-chunk
3. **Non-blocking Producer** - All chunks pushed to queue immediately without awaiting
4. **Jittered Backoff** - Rate limit handling with jitter to prevent thundering herd
5. **Diagnostics** - In-flight counts, latencies, rate-limit hits tracked and logged

## Verification

Check logs for:
```
Pipeline diagnostics: {
  peakEmbeddingInFlight: 6,    // Must exceed 2 for true parallelism
  ...
}
```

## Configuration

```env
EMBEDDING_THREADS=6   # Safe default
UPSERT_THREADS=4
```
