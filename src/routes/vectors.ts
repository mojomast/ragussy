import { Router, Request, Response } from 'express';
import { logger, env } from '../config/index.js';
import { 
  getQdrantClient, 
  getCollectionInfo, 
  checkQdrantHealth,
  ensureCollection 
} from '../services/index.js';
import { clearAllState } from '../ingestion/index.js';

const router: Router = Router();

// Get Qdrant status and collection info
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const healthy = await checkQdrantHealth();
    
    if (!healthy) {
      return res.json({
        connected: false,
        url: env.QDRANT_URL,
        collection: null,
      });
    }
    
    let collectionInfo = null;
    try {
      const info = await getCollectionInfo();
      if (info) {
        collectionInfo = {
          name: env.QDRANT_COLLECTION,
          pointsCount: (info as any).points_count || 0,
          indexedVectorsCount: (info as any).indexed_vectors_count || 0,
          vectorSize: (info as any).config?.params?.vectors?.size || env.VECTOR_DIM,
          status: (info as any).status || 'unknown',
        };
      }
    } catch {
      // Collection doesn't exist yet
    }
    
    return res.json({
      connected: true,
      url: env.QDRANT_URL,
      collection: collectionInfo,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get vector status');
    return res.status(500).json({ error: 'Failed to get vector status' });
  }
});

// List all collections
router.get('/collections', async (_req: Request, res: Response) => {
  try {
    const qdrant = getQdrantClient();
    const result = await qdrant.getCollections();
    
    const collections = await Promise.all(
      result.collections.map(async (c: any) => {
        try {
          const info = await qdrant.getCollection(c.name);
          return {
            name: c.name,
            pointsCount: (info as any).points_count || 0,
            vectorSize: (info as any).config?.params?.vectors?.size || 0,
          };
        } catch {
          return { name: c.name, pointsCount: 0, vectorSize: 0 };
        }
      })
    );
    
    return res.json({ collections });
  } catch (error) {
    logger.error({ error }, 'Failed to list collections');
    return res.status(500).json({ error: 'Failed to list collections' });
  }
});

// Create collection
router.post('/collections', async (req: Request, res: Response) => {
  try {
    const { name, vectorSize } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Collection name is required' });
    }
    
    const qdrant = getQdrantClient();
    await qdrant.createCollection(name, {
      vectors: {
        size: vectorSize || env.VECTOR_DIM,
        distance: 'Cosine',
      },
    });
    
    logger.info({ collection: name }, 'Collection created');
    return res.json({ success: true, name });
  } catch (error) {
    logger.error({ error }, 'Failed to create collection');
    return res.status(500).json({ error: 'Failed to create collection' });
  }
});

// Delete collection
router.delete('/collections/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const qdrant = getQdrantClient();
    
    await qdrant.deleteCollection(name);
    
    // If deleting the active collection, clear state
    if (name === env.QDRANT_COLLECTION) {
      await clearAllState();
    }
    
    logger.info({ collection: name }, 'Collection deleted');
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to delete collection');
    return res.status(500).json({ error: 'Failed to delete collection' });
  }
});

// Clear all vectors in current collection
router.post('/clear', async (_req: Request, res: Response) => {
  try {
    const qdrant = getQdrantClient();
    const collectionName = env.QDRANT_COLLECTION;
    
    // Delete and recreate collection
    try {
      await qdrant.deleteCollection(collectionName);
    } catch {
      // Collection might not exist
    }
    
    await ensureCollection();
    await clearAllState();
    
    logger.info({ collection: collectionName }, 'Collection cleared');
    return res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to clear collection');
    return res.status(500).json({ error: 'Failed to clear collection' });
  }
});

// Search vectors (for debugging)
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // Import embedText dynamically to avoid circular deps
    const { embedText, searchVectors } = await import('../services/index.js');
    
    const embedding = await embedText(query);
    const results = await searchVectors(embedding, limit);
    
    return res.json({
      results: results.map(r => ({
        id: r.id,
        score: r.score,
        title: r.payload.doc_title,
        section: r.payload.section_title,
        preview: String(r.payload.content || '').slice(0, 200) + '...',
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Search failed');
    return res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
