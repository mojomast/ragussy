import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { logger, getDocsPath } from '../config/index.js';
import { ingestIncremental, ingestFull, getAllFileStates } from '../ingestion/index.js';

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
    const allowedTypes = ['.zip', '.md', '.mdx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip, .md, and .mdx files are allowed'));
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
      } else if (/\.(md|mdx)$/i.test(entry.name)) {
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
        if (!/\.(md|mdx)$/i.test(entryName)) continue;
        
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
      // Single markdown file
      const targetPath = path.join(docsPath, req.file.originalname);
      await fs.rename(uploadedPath, targetPath);
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
    const { full } = req.body;
    
    logger.info({ full }, 'Starting ingestion');
    const result = full ? await ingestFull() : await ingestIncremental();
    
    return res.json({ success: true, result });
  } catch (error) {
    logger.error({ error }, 'Ingestion failed');
    return res.status(500).json({ error: 'Ingestion failed', message: String(error) });
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
