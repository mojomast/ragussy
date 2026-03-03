import fs from 'fs/promises';
import path from 'path';

const METADATA_PATH = path.join(process.cwd(), 'data', 'conversion-metadata.json');

export interface ConversionMetadataRecord {
  filePath: string;
  originalFileName: string;
  sourceMimeType: string;
  sourceFormat: string;
  converter: 'node-native' | 'convert-wasm';
  extractedTitle?: string | null;
  warnings: string[];
  ignoredInstructions: string[];
  appliedActions: string[];
  checksumSha256: string;
  convertedAt: string;
  ingestionSummary?: {
    filesUpdated: number;
    chunksUpserted: number;
    errorCount: number;
    ingestedAt: string;
  } | null;
}

interface MetadataStore {
  version: 1;
  records: Record<string, ConversionMetadataRecord>;
}

async function readStore(): Promise<MetadataStore> {
  try {
    const content = await fs.readFile(METADATA_PATH, 'utf-8');
    const parsed = JSON.parse(content) as MetadataStore;

    if (!parsed || parsed.version !== 1 || !parsed.records) {
      return { version: 1, records: {} };
    }

    return parsed;
  } catch {
    return { version: 1, records: {} };
  }
}

async function writeStore(store: MetadataStore): Promise<void> {
  await fs.mkdir(path.dirname(METADATA_PATH), { recursive: true });
  await fs.writeFile(METADATA_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export async function upsertConversionMetadata(record: ConversionMetadataRecord): Promise<void> {
  const store = await readStore();
  store.records[record.filePath] = record;
  await writeStore(store);
}

export async function getConversionMetadata(filePath: string): Promise<ConversionMetadataRecord | null> {
  const store = await readStore();
  return store.records[filePath] ?? null;
}
