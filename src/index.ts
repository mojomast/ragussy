import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env, logger } from './config/index.js';
import { chatRouter, healthRouter, adminRouter, vectorsRouter, settingsRouter, documentsRouter } from './routes/index.js';
import { ensureCollection } from './services/index.js';

const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: env.NODE_ENV === 'development' 
    ? true 
    : [env.PUBLIC_DOCS_BASE_URL],
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/chat', limiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
    }, 'Request completed');
  });
  next();
});

// Routes
app.use('/api', healthRouter);
app.use('/api/chat', chatRouter);
app.use('/api/admin', adminRouter);
app.use('/api/vectors', vectorsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/documents', documentsRouter);

// Serve frontend in production
if (env.NODE_ENV === 'production') {
  const frontendPath = path.join(process.cwd(), 'frontend', 'dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ error: err, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal server error',
    message: env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
async function start() {
  try {
    await ensureCollection();
    
    app.listen(env.PORT, '0.0.0.0', () => {
      logger.info({ 
        port: env.PORT, 
        host: '0.0.0.0', 
        env: env.NODE_ENV,
        project: env.PROJECT_NAME 
      }, '🚀 Ragussy Backend started');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});
