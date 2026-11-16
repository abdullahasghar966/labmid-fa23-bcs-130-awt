import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config, hasClientBuild } from './config.js';
import { cache } from './cache.js';
import { ApiError, ERROR_CATALOGUE, errorHandler } from './errors.js';
import { authenticate, requireRole, STAFF } from './middleware/auth.js';
import { EVENT_CATALOGUE } from './services/events.js';
import { equipmentRouter } from './routes/equipment.js';
import { loansRouter } from './routes/loans.js';
import { authRouter, usersRouter } from './routes/users.js';
import { availabilityRouter, overviewRouter } from './routes/overview.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // we sit behind Nginx
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['ETag', 'X-Cache'] }));
  app.use(express.json({ limit: '20kb' }));

  // Public
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/meta/errors', (_req, res) => res.json(ERROR_CATALOGUE)); // "Error API (409)"
  app.get('/api/meta/events', (_req, res) => res.json(EVENT_CATALOGUE));
  // Settings the browser needs before sign-in (Firebase web config is public by design)
  app.get('/api/meta/client-config', (_req, res) =>
    res.json({ firebase: config.firebase.web, devLogin: config.devAuthBypass }),
  );

  // The built React app on the same link (Nginx does this in the Docker setup)
  if (hasClientBuild()) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  // Everything below needs Google sign-in
  app.use('/api', authenticate);
  app.use('/api/auth', authRouter);
  app.use('/api/equipment', equipmentRouter);
  app.use('/api/availability', availabilityRouter);
  app.use('/api/loans', loansRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/overview', overviewRouter);
  app.get('/api/cache/stats', requireRole(...STAFF), (_req, res) => res.json(cache.stats()));

  app.use((req) => {
    throw new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`);
  });
  app.use(errorHandler);
  return app;
}
