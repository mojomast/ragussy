import { Router, Request, Response } from 'express';
import { checkQdrantHealth, getCollectionInfo } from '../services/index.js';
import { logger, env } from '../config/index.js';

const router: Router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const qdrantOk = await checkQdrantHealth();
    
    const status = {
      status: qdrantOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      project: env.PROJECT_NAME,
      services: {
        api: 'ok',
        qdrant: qdrantOk ? 'ok' : 'error',
      },
    };

    const httpStatus = qdrantOk ? 200 : 503;
    return res.status(httpStatus).json(status);
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.get('/health/detailed', async (_req: Request, res: Response) => {
  try {
    const qdrantOk = await checkQdrantHealth();
    let collectionInfo = null;
    
    if (qdrantOk) {
      try {
        collectionInfo = await getCollectionInfo();
      } catch {
        // Collection might not exist yet
      }
    }

    return res.json({
      status: qdrantOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      project: env.PROJECT_NAME,
      services: {
        api: 'ok',
        qdrant: qdrantOk ? 'ok' : 'error',
      },
      collection: collectionInfo ? {
        name: env.QDRANT_COLLECTION,
        pointsCount: (collectionInfo as any).points_count,
        indexedVectorsCount: (collectionInfo as any).indexed_vectors_count,
      } : null,
      config: {
        vectorDim: env.VECTOR_DIM,
        retrievalTopK: env.RETRIEVAL_TOP_K,
        chunkTargetTokens: env.CHUNK_TARGET_TOKENS,
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    logger.error({ error }, 'Detailed health check failed');
    return res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
