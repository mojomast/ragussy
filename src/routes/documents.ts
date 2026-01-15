import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { logger, getDocsPath, getDocsExtensions } from '../config/index.js';
import { ingestIncremental, ingestFull, ingestFullPartial, ingestSelected, getAllFileStates } from '../ingestion/index.js';

const router: Router = Router();

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

// Upload documents (single file or zip)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const docsPath = getDocsPath();
    const uploadedPath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    let addedFiles: string[] = [];
    
    if (ext === '.zip') {
      // Extract zip file
      const zip = new AdmZip(uploadedPath);
      const entries = zip.getEntries();
      
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        
        const entryName = entry.entryName;
        
        // Skip hidden files and __MACOSX
        if (entryName.includes('__MACOSX') || entryName.split('/').some(p => p.startsWith('.'))) {
          continue;
        }
        
        const targetPath = path.join(docsPath, entryName);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, entry.getData());
        addedFiles.push(entryName);
      }
      
      // Clean up uploaded zip
      await fs.unlink(uploadedPath);
    } else {
      // Single file - copy instead of rename to handle cross-filesystem moves in Docker
      const targetPath = path.join(docsPath, req.file.originalname);
      await fs.copyFile(uploadedPath, targetPath);
      await fs.unlink(uploadedPath); // Clean up the uploaded file
      addedFiles.push(req.file.originalname);
    }
    
    logger.info({ files: addedFiles.length }, 'Documents uploaded');
    return res.json({ 
      success: true, 
      filesAdded: addedFiles.length,
      files: addedFiles 
    });
  } catch (error) {
    logger.error({ error }, 'Failed to upload documents');
    return res.status(500).json({ error: 'Failed to upload documents' });
  }
});

// Delete a document
router.delete('/*', async (req: Request, res: Response) => {
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
router.post('/ingest', async (req: Request, res: Response) => {
  try {
    const { full, partial, maxChunksPerBatch, startIndex, selectedFiles } = req.body;
    
    // Debug log the entire request body
    logger.info({ body: req.body }, 'Ingest request received');
    
    // Check if embedding API is configured
    const env = await import('../config/index.js');
    if (!env.env.EMBED_API_KEY) {
      return res.status(400).json({ 
        error: 'Embedding API not configured', 
        message: 'Please configure your embedding API key in Settings and restart the server.' 
      });
    }
    
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
