import type { NextFunction, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getRuntimeSecurityConfig, logger } from '../config/index.js';

const SETUP_COMPLETE_PATH = path.join(process.cwd(), 'data', '.setup-complete');

async function isSetupComplete(): Promise<boolean> {
  try {
    await fs.access(SETUP_COMPLETE_PATH);
    const security = await getRuntimeSecurityConfig();
    return Boolean(security.apiKey && security.adminToken);
  } catch {
    return false;
  }
}

async function isRequestAuthorized(req: Request): Promise<boolean> {
  const security = await getRuntimeSecurityConfig();
  const apiKeyHeader = req.headers['x-api-key'];
  const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : '';

  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

  const adminTokenHeader = req.headers['x-admin-token'];
  const adminToken = typeof adminTokenHeader === 'string' ? adminTokenHeader : '';

  return (
    (security.apiKey.length > 0 && apiKey === security.apiKey) ||
    (security.adminToken.length > 0 && bearer === security.adminToken) ||
    (security.adminToken.length > 0 && adminToken === security.adminToken)
  );
}

export async function requireConfiguredAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const setupComplete = await isSetupComplete();

    if (!setupComplete) {
      next();
      return;
    }

    const authorized = await isRequestAuthorized(req);
    if (!authorized) {
      res.status(403).json({
        error: 'Authentication required',
        message: 'Provide x-api-key or admin token for this endpoint.',
      });
      return;
    }

    next();
  } catch (error) {
    logger.error({ error }, 'Route auth check failed');
    res.status(500).json({ error: 'Authentication check failed' });
  }
}
