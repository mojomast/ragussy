import crypto from 'crypto';
import { ingestSelected } from '../ingestion/index.js';
import { logger } from '../config/index.js';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface IngestionJob {
  id: string;
  status: JobStatus;
  filePaths: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: {
    filesUpdated: number;
    chunksUpserted: number;
    errors: string[];
  };
  error?: string;
}

const ingestionJobs = new Map<string, IngestionJob>();
const queue: string[] = [];
let processing = false;

function compactCompletedJobs(maxJobs = 200): void {
  if (ingestionJobs.size <= maxJobs) {
    return;
  }

  const sorted = Array.from(ingestionJobs.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  for (const job of sorted) {
    if (ingestionJobs.size <= maxJobs) {
      break;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      ingestionJobs.delete(job.id);
    }
  }
}

async function processQueue(): Promise<void> {
  if (processing) {
    return;
  }

  processing = true;

  try {
    while (queue.length > 0) {
      const jobId = queue.shift();
      if (!jobId) {
        continue;
      }

      const job = ingestionJobs.get(jobId);
      if (!job || job.status !== 'queued') {
        continue;
      }

      job.status = 'running';
      job.startedAt = new Date().toISOString();
      ingestionJobs.set(job.id, job);

      try {
        const result = await ingestSelected({ filePaths: job.filePaths });

        job.status = 'completed';
        job.result = {
          filesUpdated: result.filesUpdated ?? 0,
          chunksUpserted: result.chunksUpserted ?? 0,
          errors: result.errors ?? [],
        };
        job.finishedAt = new Date().toISOString();
        ingestionJobs.set(job.id, job);

        logger.info(
          {
            jobId: job.id,
            files: job.filePaths.length,
            filesUpdated: job.result.filesUpdated,
            chunksUpserted: job.result.chunksUpserted,
          },
          'Background ingestion job completed'
        );
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Unknown ingestion queue error';
        job.finishedAt = new Date().toISOString();
        ingestionJobs.set(job.id, job);

        logger.error({ error, jobId: job.id }, 'Background ingestion job failed');
      }
    }
  } finally {
    processing = false;
    compactCompletedJobs();
  }
}

export function enqueueIngestionJob(filePaths: string[]): IngestionJob {
  const job: IngestionJob = {
    id: crypto.randomUUID(),
    status: 'queued',
    filePaths: [...filePaths],
    createdAt: new Date().toISOString(),
  };

  ingestionJobs.set(job.id, job);
  queue.push(job.id);

  void processQueue();
  return job;
}

export function getIngestionJob(jobId: string): IngestionJob | null {
  return ingestionJobs.get(jobId) ?? null;
}

export function listIngestionJobs(limit = 50): IngestionJob[] {
  return Array.from(ingestionJobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit));
}
