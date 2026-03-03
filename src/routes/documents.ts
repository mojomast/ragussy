import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { logger, getDocsPath, getDocsExtensions, getRuntimeSecurityConfig } from '../config/index.js';
import { ingestIncremental, ingestFull, ingestFullPartial, ingestSelected, getAllFileStates } from '../ingestion/index.js';
import { requireConfiguredAuth } from '../middleware/route-auth.js';
import {
  convertDocumentWithIntent,
  getConversionMetadata,
  getConversionFailure,
  getFailureRawAbsolutePath,
  listConversionFailures,
  markConversionFailureRetried,
  normalizeIntent,
  recordConversionFailure,
  resolveConversionFailure,
  upsertConversionMetadata,
  type ConversionIntent,
} from '../services/index.js';

const router: Router = Router();
type ConflictStrategy = 'replace' | 'rename' | 'skip';
const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (_req, file, cb) => {
    // Accept zip files and any text-based files
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      cb(null, true);
    } else {
      // Accept any file - we'll treat it as plaintext
      cb(null, true);
    }
  },
});

// List all documents in docs folder
router.get('/', async (_req: Request, res: Response) => {
  try {
    const docsPath = getDocsPath();
    const files = await listDocsRecursive(docsPath, docsPath);
    const states = await getAllFileStates();
    
    // Merge file info with ingestion state
    const documents = files.map(file => {
      const state = states.find(s => s.filePath === file.relativePath);
      return {
        ...file,
        indexed: !!state,
        lastIndexed: state?.lastIngested?.toISOString() || null,
        chunkCount: state?.chunkCount || 0,
      };
    });
    
    return res.json({ documents, docsPath });
  } catch (error) {
    logger.error({ error }, 'Failed to list documents');
    return res.status(500).json({ error: 'Failed to list documents' });
  }
});

async function listDocsRecursive(dir: string, baseDir: string): Promise<any[]> {
  const files: any[] = [];
  const extensions = getDocsExtensions();
  
  // Build regex pattern from configured extensions
  const extPattern = new RegExp(`(${extensions.map(e => e.replace('.', '\\.')).join('|')})$`, 'i');
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      
      if (entry.isDirectory()) {
        const subFiles = await listDocsRecursive(fullPath, baseDir);
        files.push(...subFiles);
      } else if (extPattern.test(entry.name)) {
        const stats = await fs.stat(fullPath);
        files.push({
          name: entry.name,
          relativePath: relativePath.replace(/\\/g, '/'),
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
      }
    }
  } catch (error) {
    logger.error({ error, dir }, 'Failed to read directory');
  }
  
  return files;
}

function parseConflictStrategy(value: unknown): ConflictStrategy {
  if (value === 'rename' || value === 'skip') {
    return value;
  }
  return 'replace';
}

function sanitizeRelativeUploadPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Invalid upload path');
  }

  if (parts.some(part => part === '.' || part === '..')) {
    throw new Error('Invalid upload path traversal');
  }

  return parts.join('/');
}

function resolveInsideDocs(docsPath: string, relativePath: string): string {
  const docsRoot = path.resolve(docsPath);
  const absolutePath = path.resolve(docsRoot, relativePath);

  if (absolutePath !== docsRoot && !absolutePath.startsWith(`${docsRoot}${path.sep}`)) {
    throw new Error('Upload path escapes docs directory');
  }

  return absolutePath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function addNumericSuffix(relativePath: string, index: number): string {
  const ext = path.extname(relativePath);
  const dir = path.posix.dirname(relativePath);
  const base = path.basename(relativePath, ext);
  const candidate = `${base}-${index}${ext}`;
  return dir === '.' ? candidate : `${dir}/${candidate}`;
}

async function resolveConflictPath(
  docsPath: string,
  requestedRelativePath: string,
  strategy: ConflictStrategy
): Promise<
  | { action: 'skip'; relativePath: string }
  | { action: 'write'; relativePath: string; absolutePath: string; renamedFrom?: string }
> {
  const sanitized = sanitizeRelativeUploadPath(requestedRelativePath);
  const absolutePath = resolveInsideDocs(docsPath, sanitized);
  const exists = await fileExists(absolutePath);

  if (!exists || strategy === 'replace') {
    return { action: 'write', relativePath: sanitized, absolutePath };
  }

  if (strategy === 'skip') {
    return { action: 'skip', relativePath: sanitized };
  }

  for (let i = 1; i <= 10000; i += 1) {
    const renamed = addNumericSuffix(sanitized, i);
    const renamedAbsolutePath = resolveInsideDocs(docsPath, renamed);
    if (!(await fileExists(renamedAbsolutePath))) {
      return {
        action: 'write',
        relativePath: renamed,
        absolutePath: renamedAbsolutePath,
        renamedFrom: sanitized,
      };
    }
  }

  throw new Error('Could not resolve a unique file name for upload');
}

function parseBooleanFlag(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parseIntentFromBody(intentRaw: unknown): ConversionIntent {
  if (!intentRaw) {
    return normalizeIntent({});
  }

  if (typeof intentRaw === 'string') {
    return normalizeIntent(JSON.parse(intentRaw));
  }

  return normalizeIntent(intentRaw);
}

function extractTitleFromMarkdown(markdown: string): string | null {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (!headingMatch?.[1]) {
    return null;
  }

  return headingMatch[1].trim();
}

interface ConvertAndStoreParams {
  originalFileName: string;
  sourceMimeType: string;
  bytes: Uint8Array;
  conflictStrategy: ConflictStrategy;
  ingestNow: boolean;
  intent: ConversionIntent;
}

async function convertAndStoreDocument(params: ConvertAndStoreParams): Promise<{
  conflictStrategy: ConflictStrategy;
  filesAdded: number;
  files: string[];
  skippedFiles: string[];
  renamedFiles: Array<{ from: string; to: string }>;
  conversion: {
    sourceFormat: string;
    converter: 'node-native' | 'convert-wasm';
    extractedTitle: string | null;
    appliedActions: string[];
    warnings: string[];
    ignoredInstructions: string[];
    markdownLength: number;
  };
  ingestion: any;
}> {
  const docsPath = getDocsPath();
  const converted = await convertDocumentWithIntent(
    {
      fileName: params.originalFileName,
      mimeType: params.sourceMimeType,
      bytes: params.bytes,
    },
    params.intent
  );

  const resolved = await resolveConflictPath(docsPath, converted.fileName, params.conflictStrategy);
  const skippedFiles: string[] = [];
  const renamedFiles: Array<{ from: string; to: string }> = [];
  const writtenFiles: string[] = [];

  if (resolved.action === 'skip') {
    skippedFiles.push(resolved.relativePath);
  } else {
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.writeFile(resolved.absolutePath, converted.markdown, 'utf-8');
    writtenFiles.push(resolved.relativePath);

    if (resolved.renamedFrom) {
      renamedFiles.push({ from: resolved.renamedFrom, to: resolved.relativePath });
    }
  }

  let ingestionResult: any = null;
  if (params.ingestNow && writtenFiles.length > 0) {
    ingestionResult = await ingestSelected({ filePaths: writtenFiles });
  }

  if (writtenFiles.length > 0) {
    await upsertConversionMetadata({
      filePath: writtenFiles[0],
      originalFileName: params.originalFileName,
      sourceMimeType: params.sourceMimeType || 'application/octet-stream',
      sourceFormat: converted.sourceFormat,
      converter: converted.converter,
      extractedTitle: extractTitleFromMarkdown(converted.markdown),
      warnings: converted.warnings,
      ignoredInstructions: converted.ignoredInstructions,
      appliedActions: converted.appliedActions,
      checksumSha256: crypto
        .createHash('sha256')
        .update(converted.markdown, 'utf-8')
        .digest('hex'),
      convertedAt: new Date().toISOString(),
      ingestionSummary: ingestionResult
        ? {
            filesUpdated: ingestionResult.filesUpdated ?? 0,
            chunksUpserted: ingestionResult.chunksUpserted ?? 0,
            errorCount: Array.isArray(ingestionResult.errors) ? ingestionResult.errors.length : 0,
            ingestedAt: new Date().toISOString(),
          }
        : null,
    });
  }

  return {
    conflictStrategy: params.conflictStrategy,
    filesAdded: writtenFiles.length,
    files: writtenFiles,
    skippedFiles,
    renamedFiles,
    conversion: {
      sourceFormat: converted.sourceFormat,
      converter: converted.converter,
      extractedTitle: extractTitleFromMarkdown(converted.markdown),
      appliedActions: converted.appliedActions,
      warnings: converted.warnings,
      ignoredInstructions: converted.ignoredInstructions,
      markdownLength: converted.markdown.length,
    },
    ingestion: ingestionResult,
  };
}

function validateZipEntries(entries: AdmZip.IZipEntry[]): void {
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`Zip contains too many entries (${entries.length}). Limit is ${MAX_ZIP_ENTRIES}.`);
  }

  let totalUncompressed = 0;

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }

    const uncompressedSize = Number((entry as any).header?.size ?? 0);
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new Error(
        `Zip entry is too large (${entry.entryName}: ${uncompressedSize} bytes). ` +
          `Max per entry is ${MAX_ZIP_ENTRY_BYTES} bytes.`
      );
    }

    totalUncompressed += Math.max(uncompressedSize, 0);
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Zip uncompressed size exceeds limit (${MAX_ZIP_UNCOMPRESSED_BYTES} bytes).`
      );
    }
  }
}

function guessMimeTypeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'text/markdown';
  if (ext === '.txt' || ext === '.log' || ext === '.csv' || ext === '.tsv') return 'text/plain';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.json') return 'application/json';
  if (ext === '.xml') return 'application/xml';
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

// Get document content
router.get('/content/*', async (req: Request, res: Response) => {
  try {
    const relativePath = req.params[0];
    const docsPath = getDocsPath();
    const fullPath = path.join(docsPath, relativePath);
    
    // Security: ensure path is within docs folder
    if (!fullPath.startsWith(docsPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const content = await fs.readFile(fullPath, 'utf-8');
    return res.json({ content, path: relativePath });
  } catch (error) {
    logger.error({ error }, 'Failed to read document');
    return res.status(404).json({ error: 'Document not found' });
  }
});

// Get conversion metadata for a document
router.get('/conversion-metadata/*', async (req: Request, res: Response) => {
  try {
    const relativePath = sanitizeRelativeUploadPath(req.params[0]);
    const metadata = await getConversionMetadata(relativePath);

    if (!metadata) {
      return res.status(404).json({ error: 'No conversion metadata found' });
    }

    return res.json({ metadata });
  } catch (error) {
    logger.error({ error }, 'Failed to get conversion metadata');
    return res.status(500).json({ error: 'Failed to get conversion metadata' });
  }
});

// Upload documents (single file or zip)
router.post('/upload', requireConfiguredAuth, upload.single('file'), async (req: Request, res: Response) => {
  let uploadedPath = '';

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const docsPath = getDocsPath();
    uploadedPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const conflictStrategy = parseConflictStrategy(req.body?.conflictStrategy);

    let addedFiles: string[] = [];
    let skippedFiles: string[] = [];
    let renamedFiles: Array<{ from: string; to: string }> = [];

    if (ext === '.zip') {
      // Extract zip file
      const zip = new AdmZip(uploadedPath);
      const entries = zip.getEntries();
      validateZipEntries(entries);

      for (const entry of entries) {
        if (entry.isDirectory) continue;

        const entryName = entry.entryName;

        // Skip hidden files and __MACOSX
        if (entryName.includes('__MACOSX') || entryName.split('/').some(p => p.startsWith('.'))) {
          continue;
        }

        const resolved = await resolveConflictPath(docsPath, entryName, conflictStrategy);
        if (resolved.action === 'skip') {
          skippedFiles.push(resolved.relativePath);
          continue;
        }

        await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
        await fs.writeFile(resolved.absolutePath, entry.getData());
        addedFiles.push(resolved.relativePath);

        if (resolved.renamedFrom) {
          renamedFiles.push({ from: resolved.renamedFrom, to: resolved.relativePath });
        }
      }
    } else {
      // Single file - copy instead of rename to handle cross-filesystem moves in Docker
      const requestedName = path.basename(req.file.originalname);
      const resolved = await resolveConflictPath(docsPath, requestedName, conflictStrategy);

      if (resolved.action === 'skip') {
        skippedFiles.push(resolved.relativePath);
      } else {
        await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
        await fs.copyFile(uploadedPath, resolved.absolutePath);
        addedFiles.push(resolved.relativePath);

        if (resolved.renamedFrom) {
          renamedFiles.push({ from: resolved.renamedFrom, to: resolved.relativePath });
        }
      }
    }

    logger.info(
      {
        filesAdded: addedFiles.length,
        skipped: skippedFiles.length,
        renamed: renamedFiles.length,
        conflictStrategy,
      },
      'Documents uploaded'
    );

    return res.json({ 
      success: true,
      conflictStrategy,
      filesAdded: addedFiles.length,
      files: addedFiles,
      skippedFiles,
      renamedFiles,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to upload documents');
    return res.status(500).json({ error: 'Failed to upload documents' });
  } finally {
    if (uploadedPath) {
      await fs.unlink(uploadedPath).catch(() => undefined);
    }
  }
});

// Convert + upload in one request (for Discord bot and future UI use)
router.post('/convert-upload', requireConfiguredAuth, upload.single('file'), async (req: Request, res: Response) => {
  let uploadedPath = '';
  let uploadedBytes: Uint8Array | null = null;
  let originalFileName = '';
  let sourceMimeType = '';
  let conflictStrategy: ConflictStrategy = 'replace';
  let ingestNow = true;
  let intent: ConversionIntent = normalizeIntent({});

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    uploadedPath = req.file.path;
    originalFileName = req.file.originalname;
    sourceMimeType = req.file.mimetype || 'application/octet-stream';

    conflictStrategy = parseConflictStrategy(req.body?.conflictStrategy);
    ingestNow = parseBooleanFlag(req.body?.ingestNow, true);
    intent = parseIntentFromBody(req.body?.intent);

    uploadedBytes = new Uint8Array(await fs.readFile(uploadedPath));

    const result = await convertAndStoreDocument({
      originalFileName,
      sourceMimeType,
      bytes: uploadedBytes,
      conflictStrategy,
      ingestNow,
      intent,
    });

    logger.info(
      {
        originalFileName,
        storedFile: result.files[0] ?? null,
        sourceFormat: result.conversion.sourceFormat,
        actions: result.conversion.appliedActions,
        warnings: result.conversion.warnings.length,
        conflictStrategy,
        ingestNow,
      },
      'Converted upload completed'
    );

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to convert and upload document';
    let failureId: string | null = null;

    if (uploadedBytes && originalFileName) {
      try {
        const failure = await recordConversionFailure({
          originalFileName,
          sourceMimeType: sourceMimeType || 'application/octet-stream',
          rawBytes: uploadedBytes,
          intent,
          conflictStrategy,
          ingestNow,
          error: errorMessage,
        });
        failureId = failure.id;
      } catch (recordError) {
        logger.error({ recordError }, 'Failed to persist conversion failure payload');
      }
    }

    logger.error({ error, failureId }, 'Failed to convert-upload document');
    return res.status(500).json({
      error: errorMessage,
      conversionFailureId: failureId,
    });
  } finally {
    if (uploadedPath) {
      await fs.unlink(uploadedPath).catch(() => undefined);
    }
  }
});

router.post('/convert-zip', requireConfiguredAuth, upload.single('file'), async (req: Request, res: Response) => {
  let uploadedPath = '';

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (path.extname(req.file.originalname).toLowerCase() !== '.zip') {
      return res.status(400).json({ error: 'Only .zip files are supported for bulk conversion' });
    }

    uploadedPath = req.file.path;
    const conflictStrategy = parseConflictStrategy(req.body?.conflictStrategy);
    const ingestNow = parseBooleanFlag(req.body?.ingestNow, false);
    const intent = parseIntentFromBody(req.body?.intent);

    const zip = new AdmZip(uploadedPath);
    const entries = zip.getEntries();
    validateZipEntries(entries);

    const rows: Array<{
      fileName: string;
      status: 'converted' | 'skipped' | 'failed';
      storedFile?: string;
      message?: string;
      warnings?: string[];
    }> = [];
    const allWrittenFiles: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }

      const entryName = entry.entryName;
      if (entryName.includes('__MACOSX') || entryName.split('/').some(part => part.startsWith('.'))) {
        continue;
      }

      try {
        const result = await convertAndStoreDocument({
          originalFileName: entryName,
          sourceMimeType: guessMimeTypeFromFileName(entryName),
          bytes: new Uint8Array(entry.getData()),
          conflictStrategy,
          ingestNow: false,
          intent,
        });

        if (result.filesAdded > 0) {
          allWrittenFiles.push(...result.files);
          rows.push({
            fileName: entryName,
            status: 'converted',
            storedFile: result.files[0],
            warnings: result.conversion.warnings,
          });
        } else {
          rows.push({
            fileName: entryName,
            status: 'skipped',
            message: result.skippedFiles[0] ? 'Skipped due to conflict strategy' : 'Skipped',
          });
        }
      } catch (entryError) {
        const message = entryError instanceof Error ? entryError.message : 'Unknown conversion error';
        rows.push({
          fileName: entryName,
          status: 'failed',
          message,
        });
      }
    }

    let ingestionResult: any = null;
    if (ingestNow && allWrittenFiles.length > 0) {
      ingestionResult = await ingestSelected({ filePaths: allWrittenFiles });
    }

    return res.json({
      success: true,
      conflictStrategy,
      ingestNow,
      totals: {
        processed: rows.length,
        converted: rows.filter(row => row.status === 'converted').length,
        skipped: rows.filter(row => row.status === 'skipped').length,
        failed: rows.filter(row => row.status === 'failed').length,
      },
      rows,
      ingestion: ingestionResult,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to convert zip upload');
    return res.status(500).json({ error: 'Failed to convert zip upload' });
  } finally {
    if (uploadedPath) {
      await fs.unlink(uploadedPath).catch(() => undefined);
    }
  }
});

router.get('/conversion-failures', requireConfiguredAuth, async (_req: Request, res: Response) => {
  try {
    const failures = await listConversionFailures();
    return res.json({ failures });
  } catch (error) {
    logger.error({ error }, 'Failed to list conversion failures');
    return res.status(500).json({ error: 'Failed to list conversion failures' });
  }
});

router.post('/conversion-failures/:id/retry', requireConfiguredAuth, async (req: Request, res: Response) => {
  try {
    const failure = await getConversionFailure(req.params.id);
    if (!failure) {
      return res.status(404).json({ error: 'Conversion failure record not found' });
    }

    const rawPath = getFailureRawAbsolutePath(failure.rawRelativePath);
    const rawBytes = new Uint8Array(await fs.readFile(rawPath));

    const conflictStrategy = parseConflictStrategy(req.body?.conflictStrategy ?? failure.conflictStrategy);
    const ingestNow = parseBooleanFlag(req.body?.ingestNow, failure.ingestNow);
    const intent = parseIntentFromBody(req.body?.intent ?? failure.intent);

    try {
      const result = await convertAndStoreDocument({
        originalFileName: failure.originalFileName,
        sourceMimeType: failure.sourceMimeType,
        bytes: rawBytes,
        conflictStrategy,
        ingestNow,
        intent,
      });

      await resolveConversionFailure(failure.id);
      return res.json({ success: true, ...result });
    } catch (retryError) {
      const retryMessage = retryError instanceof Error ? retryError.message : 'Retry failed';
      await markConversionFailureRetried(failure.id, retryMessage);
      return res.status(500).json({ error: retryMessage });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to retry conversion failure');
    return res.status(500).json({ error: 'Failed to retry conversion failure' });
  }
});

// Delete a document
router.delete('/*', requireConfiguredAuth, async (req: Request, res: Response) => {
  try {
    const relativePath = req.params[0];
    const docsPath = getDocsPath();
    const fullPath = path.join(docsPath, relativePath);
    
    // Security: ensure path is within docs folder
    if (!fullPath.startsWith(docsPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await fs.unlink(fullPath);
    logger.info({ path: relativePath }, 'Document deleted');
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete document');
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Trigger ingestion
router.post('/ingest', requireConfiguredAuth, async (req: Request, res: Response) => {
  try {
    const { full, partial, maxChunksPerBatch, startIndex, selectedFiles } = req.body;
    
    // Debug log the entire request body
    logger.info({ body: req.body }, 'Ingest request received');
    
    // Check if embedding API is configured
    const runtimeSecurity = await getRuntimeSecurityConfig();
    if (!runtimeSecurity.embedApiKey) {
      return res.status(400).json({ 
        error: 'Embedding API not configured', 
        message: 'Please configure your embedding API key in Settings.' 
      });
    }
    
    // Check if forum mode is enabled (read from .env file for hot-reload)
    const envFile = await fs.readFile(path.join(process.cwd(), '.env'), 'utf-8').catch(() => '');
    const forumModeMatch = envFile.match(/^FORUM_MODE=(.*)$/m);
    const forumModeEnabled = forumModeMatch?.[1]?.trim() === 'true';
    
    if (forumModeEnabled) {
      logger.info('Forum mode enabled - using forum ingestion pipeline');
      
      // Import forum pipeline dynamically
      const { runForumPipeline } = await import('../ingestion/forum/forum-pipeline.js');
      const { getForumIngestionConfig } = await import('../ingestion/forum/forum-config.js');
      
      // Get forum config from .env
      const forumConfig = await getForumIngestionConfig();
      
      // Run forum pipeline
      const report = await runForumPipeline(forumConfig);
      
      return res.json({ 
        success: true, 
        result: {
          filesUpdated: report.threadsProcessed,
          chunksUpserted: report.chunksEmbedded,
          filesDeleted: 0,
          chunksDeleted: 0,
          postsProcessed: report.postsProcessed,
          postsSkipped: report.postsSkipped,
          errors: report.failedPosts.map(f => `${f.threadId}/${f.postId}: ${f.reason}`),
          forumMode: true,
          diagnostics: report.diagnostics,
        }
      });
    }
    
    // Standard document ingestion
    // Log what we're doing
    if (selectedFiles && Array.isArray(selectedFiles) && selectedFiles.length > 0) {
      logger.info({ files: selectedFiles, count: selectedFiles.length }, 'Starting selective ingestion');
      // Selective ingestion - only ingest specified files
      const result = await ingestSelected({
        filePaths: selectedFiles,
      });
      return res.json({ success: true, result });
    } else if (partial) {
      logger.info({ full, maxChunksPerBatch, startIndex }, 'Starting partial ingestion');
      // Partial ingestion for large datasets
      const result = await ingestFullPartial({
        maxChunksPerBatch: maxChunksPerBatch || 500,
        startIndex: startIndex || 0,
      });
      return res.json({ success: true, result });
    } else {
      logger.info({ full }, 'Starting full/incremental ingestion');
      const result = full ? await ingestFull() : await ingestIncremental();
      return res.json({ success: true, result });
    }
  } catch (error: any) {
    logger.error({ error }, 'Ingestion failed');
    
    // Provide more helpful error messages
    let message = String(error);
    if (message.includes('401') || message.includes('Unauthorized')) {
      message = 'Embedding API authentication failed. Check your API key and restart the server.';
    } else if (message.includes('dimension mismatch')) {
      message = error.message;
    } else if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      message = 'Could not connect to embedding API. Check your base URL and restart the server.';
    }
    
    return res.status(500).json({ error: 'Ingestion failed', message });
  }
});

// Get ingestion status
router.get('/ingestion-status', async (_req: Request, res: Response) => {
  try {
    const states = await getAllFileStates();
    return res.json({
      totalFiles: states.length,
      totalChunks: states.reduce((sum, s) => sum + s.chunkCount, 0),
      lastIngested: states.length > 0 
        ? new Date(Math.max(...states.map(s => s.lastIngested.getTime()))).toISOString()
        : null,
    });
  } catch (error) {
    return res.json({ totalFiles: 0, totalChunks: 0, lastIngested: null });
  }
});

export default router;
