import initSqlJs, { Database } from 'sql.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../config/index.js';

const STATE_DB_PATH = process.env.STATE_DB_PATH || './data/ingestion-state.db';

let db: Database | null = null;

async function ensureDataDir(): Promise<void> {
  const dir = path.dirname(STATE_DB_PATH);
  await fs.mkdir(dir, { recursive: true });
}

async function loadDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  
  try {
    await ensureDataDir();
    const buffer = await fs.readFile(STATE_DB_PATH);
    return new SQL.Database(buffer);
  } catch (error) {
    logger.info('Creating new state database');
    return new SQL.Database();
  }
}

async function saveDatabase(): Promise<void> {
  if (!db) return;
  
  const data = db.export();
  const buffer = Buffer.from(data);
  await ensureDataDir();
  await fs.writeFile(STATE_DB_PATH, buffer);
}

export async function initStateStore(): Promise<void> {
  if (db) return;
  
  db = await loadDatabase();
  
  db.run(`
    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      last_ingested TEXT NOT NULL,
      chunk_count INTEGER NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS chunk_ids (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      FOREIGN KEY (file_path) REFERENCES ingested_files(file_path) ON DELETE CASCADE
    )
  `);
  
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_chunk_file_path ON chunk_ids(file_path)
  `);
  
  await saveDatabase();
  logger.info('State store initialized');
}

export interface FileState {
  filePath: string;
  contentHash: string;
  lastIngested: Date;
  chunkCount: number;
}

export async function getFileState(filePath: string): Promise<FileState | null> {
  if (!db) await initStateStore();
  
  const result = db!.exec(
    `SELECT file_path, content_hash, last_ingested, chunk_count 
     FROM ingested_files 
     WHERE file_path = ?`,
    [filePath]
  );
  
  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }
  
  const row = result[0].values[0];
  return {
    filePath: row[0] as string,
    contentHash: row[1] as string,
    lastIngested: new Date(row[2] as string),
    chunkCount: row[3] as number,
  };
}

export async function getAllFileStates(): Promise<FileState[]> {
  if (!db) await initStateStore();
  
  const result = db!.exec(
    `SELECT file_path, content_hash, last_ingested, chunk_count FROM ingested_files`
  );
  
  if (result.length === 0) {
    return [];
  }
  
  return result[0].values.map((row: any) => ({
    filePath: row[0] as string,
    contentHash: row[1] as string,
    lastIngested: new Date(row[2] as string),
    chunkCount: row[3] as number,
  }));
}

export async function updateFileState(
  filePath: string,
  contentHash: string,
  chunkIds: string[]
): Promise<void> {
  if (!db) await initStateStore();
  
  db!.run(`DELETE FROM chunk_ids WHERE file_path = ?`, [filePath]);
  
  db!.run(
    `INSERT OR REPLACE INTO ingested_files (file_path, content_hash, last_ingested, chunk_count)
     VALUES (?, ?, ?, ?)`,
    [filePath, contentHash, new Date().toISOString(), chunkIds.length]
  );
  
  for (const id of chunkIds) {
    db!.run(
      `INSERT INTO chunk_ids (id, file_path) VALUES (?, ?)`,
      [id, filePath]
    );
  }
  
  await saveDatabase();
}

export async function getChunkIdsForFile(filePath: string): Promise<string[]> {
  if (!db) await initStateStore();
  
  const result = db!.exec(
    `SELECT id FROM chunk_ids WHERE file_path = ?`,
    [filePath]
  );
  
  if (result.length === 0) {
    return [];
  }
  
  return result[0].values.map((row: any) => row[0] as string);
}

export async function deleteFileState(filePath: string): Promise<string[]> {
  if (!db) await initStateStore();
  
  const chunkIds = await getChunkIdsForFile(filePath);
  
  db!.run(`DELETE FROM ingested_files WHERE file_path = ?`, [filePath]);
  
  await saveDatabase();
  return chunkIds;
}

export async function clearAllState(): Promise<void> {
  if (!db) await initStateStore();
  
  db!.run(`DELETE FROM chunk_ids`);
  db!.run(`DELETE FROM ingested_files`);
  
  await saveDatabase();
  logger.info('Cleared all ingestion state');
}

export async function closeStateStore(): Promise<void> {
  if (db) {
    await saveDatabase();
    db.close();
    db = null;
  }
}
