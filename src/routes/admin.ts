import { Router, Request, Response, NextFunction } from 'express';
import { logger, getRuntimeSecurityConfig } from '../config/index.js';
import { ingestIncremental, ingestFull } from '../ingestion/index.js';

const router: Router = Router();

// Admin authentication middleware
async function adminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const runtimeSecurity = await getRuntimeSecurityConfig();

    if (!runtimeSecurity.adminToken) {
      return res.status(503).json({
        error: 'System not configured',
        message: 'Please complete the initial setup first',
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.substring(7);
    if (token !== runtimeSecurity.adminToken) {
      logger.warn({ ip: req.ip }, 'Invalid admin token attempt');
      return res.status(403).json({ error: 'Invalid token' });
    }

    next();
  } catch (error) {
    logger.error({ error }, 'Admin auth failed');
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

router.use(adminAuth);

router.post('/reindex', async (_req: Request, res: Response) => {
  logger.info('Admin triggered incremental reindex');
  
  try {
    const result = await ingestIncremental();
    
    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    logger.error({ error }, 'Reindex failed');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.post('/reindex/full', async (_req: Request, res: Response) => {
  logger.info('Admin triggered full reindex');
  
  try {
    const result = await ingestFull();
    
    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    logger.error({ error }, 'Full reindex failed');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
