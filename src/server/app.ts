import compression from 'compression';
import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { StatusResponse } from '../shared/api';
import type { AiProvider } from './ai/types';
import type { ServerConfig } from './config';
import { errorHandler, HttpError } from './http/errors';
import { aiRateLimit, securityHeaders } from './http/security';
import type { Logger } from './logger';
import { planRoutes } from './routes/plans';

export const APP_VERSION = '1.0.0';
export { HttpError } from './http/errors';

const MAX_BODY = '200kb';

export interface AppDeps {
  config: ServerConfig;
  provider: AiProvider;
  logger: Logger;
  now?: () => Date;
  /** Built client files; served with an SPA fallback when present. */
  staticDir?: string;
}

function statusBody(provider: AiProvider): StatusResponse {
  return {
    ok: true,
    ai: { provider: provider.name, model: provider.model, configured: provider.configured, sampleData: provider.name === 'sample' },
    version: APP_VERSION,
  };
}

function apiRouter({ config, provider, now = () => new Date() }: AppDeps): express.Router {
  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: MAX_BODY, strict: true }));
  api.get('/status', (_req, res) => {
    res.json(statusBody(provider));
  });
  api.use(planRoutes({ provider, aiLimiter: aiRateLimit(config), now }));
  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'This API route does not exist.')));
  return api;
}

/** Serves the built React app: hashed assets cached for a year, every other path falls back to index.html. */
function serveClient(app: Express, staticDir: string): void {
  app.use('/assets', express.static(path.join(staticDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxy);
  app.use(...securityHeaders(deps.config));
  app.use(compression());
  app.use('/api', apiRouter(deps));
  if (deps.staticDir && existsSync(deps.staticDir)) serveClient(app, deps.staticDir);
  app.use(errorHandler(deps.logger));
  return app;
}
