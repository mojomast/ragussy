import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const FAILURE_STORE_PATH = path.join(process.cwd(), 'data', 'conversion-failures.json');
const FAILURE_RAW_DIR = path.join(process.cwd(), 'data', 'conversion-failures', 'raw');

export interface ConversionFailureRecord {
  id: string;
  originalFileName: string;
  sourceMimeType: string;
  rawRelativePath: string;
  intent: unknown;
  conflictStrategy: 'replace' | 'rename' | 'skip';
  ingestNow: boolean;
  ingestAsync: boolean;
  error: string;
  createdAt: string;
  retryCount: number;
  lastRetriedAt?: string;
  resolvedAt?: string;
}

interface ConversionFailureStore {
  version: 1;
  records: Record<string, ConversionFailureRecord>;
}

async function readStore(): Promise<ConversionFailureStore> {
  try {
    const content = await fs.readFile(FAILURE_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(content) as ConversionFailureStore;
    if (!parsed || parsed.version !== 1 || !parsed.records) {
      return { version: 1, records: {} };
    }
    return parsed;
  } catch {
    return { version: 1, records: {} };
  }
}

async function writeStore(store: ConversionFailureStore): Promise<void> {
  await fs.mkdir(path.dirname(FAILURE_STORE_PATH), { recursive: true });
  await fs.writeFile(FAILURE_STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function sanitizeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '-');
}

export async function recordConversionFailure(params: {
  originalFileName: string;
  sourceMimeType: string;
  rawBytes: Uint8Array;
  intent: unknown;
  conflictStrategy: 'replace' | 'rename' | 'skip';
  ingestNow: boolean;
  ingestAsync: boolean;
  error: string;
}): Promise<ConversionFailureRecord> {
  const id = crypto.randomUUID();
  const safeName = sanitizeFileName(params.originalFileName) || 'upload.bin';
  const rawRelativePath = `${id}-${safeName}`;
  const rawAbsolutePath = path.join(FAILURE_RAW_DIR, rawRelativePath);

  await fs.mkdir(FAILURE_RAW_DIR, { recursive: true });
  await fs.writeFile(rawAbsolutePath, Buffer.from(params.rawBytes));

  const record: ConversionFailureRecord = {
    id,
    originalFileName: params.originalFileName,
    sourceMimeType: params.sourceMimeType,
    rawRelativePath,
    intent: params.intent,
    conflictStrategy: params.conflictStrategy,
    ingestNow: params.ingestNow,
    ingestAsync: params.ingestAsync,
    error: params.error,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };

  const store = await readStore();
  store.records[id] = record;
  await writeStore(store);
  return record;
}

export async function listConversionFailures(): Promise<ConversionFailureRecord[]> {
  const store = await readStore();
  return Object.values(store.records)
    .filter(record => !record.resolvedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getConversionFailure(id: string): Promise<ConversionFailureRecord | null> {
  const store = await readStore();
  return store.records[id] ?? null;
}

export async function markConversionFailureRetried(id: string, error?: string): Promise<void> {
  const store = await readStore();
  const existing = store.records[id];
  if (!existing) {
    return;
  }

  existing.retryCount += 1;
  existing.lastRetriedAt = new Date().toISOString();
  if (error) {
    existing.error = error;
  }

  store.records[id] = existing;
  await writeStore(store);
}

export async function resolveConversionFailure(id: string): Promise<void> {
  const store = await readStore();
  const existing = store.records[id];
  if (!existing) {
    return;
  }

  const rawAbsolutePath = path.join(FAILURE_RAW_DIR, existing.rawRelativePath);
  await fs.unlink(rawAbsolutePath).catch(() => undefined);

  existing.resolvedAt = new Date().toISOString();
  store.records[id] = existing;
  await writeStore(store);
}

export function getFailureRawAbsolutePath(rawRelativePath: string): string {
  return path.join(FAILURE_RAW_DIR, path.basename(rawRelativePath));
}
