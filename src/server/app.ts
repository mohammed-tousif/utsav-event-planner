import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ApiErrorBody, ApiErrorCode, GenerateResponse, ReviseResponse, StatusResponse } from '../shared/api';
import { BudgetInfeasibleError } from '../shared/budget';
import { daysBetween, todayISO } from '../shared/dates';
import { assemblePlan } from '../shared/plan';
import { applyRevision, RevisionError } from '../shared/revision';
import { GenerateRequestSchema, ReviseRequestSchema, type Plan } from '../shared/schemas';
import { checkEventDate, DateRangeError } from '../shared/timeline';
import { AiError, type AiErrorKind, type AiProvider } from './ai/types';
import { hashKey, TtlCache } from './cache';
import type { ServerConfig } from './config';
import type { Logger } from './logger';

export const APP_VERSION = '1.0.0';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const AI_ERROR_STATUS: Record<AiErrorKind, [number, ApiErrorCode]> = {
  not_configured: [503, 'ai_not_configured'],
  rate_limited: [429, 'ai_rate_limited'],
  timeout: [504, 'ai_timeout'],
  invalid_output: [502, 'ai_invalid_output'],
  blocked: [422, 'ai_blocked'],
  unavailable: [503, 'ai_unavailable'],
};

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.filter((p) => p !== 'input').join('.') || 'request';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'invalid_input', 'Some details need fixing before we can plan.', fieldErrors(result.error));
  }
  return result.data;
}

/**
 * The browser sends its local date so plans use the user's calendar. It must
 * be within a day of the server's UTC date, which covers every time zone.
 */
function resolveToday(clientToday: string, now: Date): string {
  const serverToday = todayISO('UTC', now);
  if (Math.abs(daysBetween(serverToday, clientToday)) > 1) {
    throw new HttpError(400, 'invalid_input', 'Your device date looks wrong. Check the date and time settings.', {
      clientToday: 'Device date is more than a day away from the current date.',
    });
  }
  return clientToday;
}

function mapDomainError(error: unknown): never {
  if (error instanceof DateRangeError) throw new HttpError(400, 'invalid_date', error.message, { eventDate: error.message });
  if (error instanceof BudgetInfeasibleError) throw new HttpError(422, 'budget_infeasible', error.message);
  if (error instanceof RevisionError) {
    if (error.code === 'no_change') throw new HttpError(422, 'no_change', error.message);
    if (error.code === 'infeasible') throw new HttpError(422, 'budget_infeasible', error.message);
    throw new HttpError(400, 'invalid_date', error.message);
  }
  if (error instanceof AiError) {
    const [status, code] = AI_ERROR_STATUS[error.kind];
    throw new HttpError(status, code, error.message, undefined, error.retryAfterSeconds);
  }
  throw error;
}

export interface AppDeps {
  config: ServerConfig;
  provider: AiProvider;
  logger: Logger;
  now?: () => Date;
  staticDir?: string;
}

export function createApp({ config, provider, logger, now = () => new Date(), staticDir }: AppDeps) {
  const app = express();
  const planCache = new TtlCache<Plan>(100, 30 * 60_000);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'none'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });
  app.use(compression());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '200kb', strict: true }));

  const aiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxAiRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      const body: ApiErrorBody = {
        error: {
          code: 'rate_limited',
          message: 'You have made a lot of AI requests. Wait a few minutes and try again.',
          retryAfterSeconds: Math.ceil(options.windowMs / 1000),
        },
      };
      res.status(429).json(body);
    },
  });

  api.get('/status', (_req, res) => {
    const body: StatusResponse = {
      ok: true,
      ai: {
        provider: provider.name,
        model: provider.model,
        configured: provider.configured,
        sampleData: provider.name === 'sample',
      },
      version: APP_VERSION,
    };
    res.json(body);
  });

  api.post('/plans', aiLimiter, async (req, res, next) => {
    try {
      const { input, clientToday } = parseBody(GenerateRequestSchema, req.body);
      const today = resolveToday(clientToday, now());
      const key = hashKey({ input, today, model: provider.model });
      const cached = planCache.get(key);
      if (cached) {
        const body: GenerateResponse = { plan: { ...cached, id: globalThis.crypto.randomUUID() }, cached: true };
        res.json(body);
        return;
      }
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      const plan = await (async () => {
        try {
          checkEventDate(input.eventDate, today);
          const result = await provider.generatePlan(input, today, controller.signal);
          return assemblePlan(
            input,
            result.data,
            {
              source: provider.name === 'sample' ? 'sample' : 'ai',
              provider: provider.name === 'sample' ? 'Sample data' : 'Google Gemini',
              model: result.model,
              generatedAt: now().toISOString(),
            },
            today,
          );
        } catch (error) {
          return mapDomainError(error);
        }
      })();
      planCache.set(key, plan);
      const body: GenerateResponse = { plan, cached: false };
      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  api.post('/plans/revise', aiLimiter, async (req, res, next) => {
    try {
      const { plan, request, clientToday } = parseBody(ReviseRequestSchema, req.body);
      const today = resolveToday(clientToday, now());
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      const result = await (async () => {
        try {
          const ai = await provider.revisePlan(plan, request, today, controller.signal);
          const applied = applyRevision(plan, ai.data, request, today);
          applied.plan.meta = { ...applied.plan.meta, model: ai.model };
          return applied;
        } catch (error) {
          return mapDomainError(error);
        }
      })();
      const body: ReviseResponse = result;
      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'This API route does not exist.')));
  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(
      '/assets',
      express.static(path.join(staticDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
    );
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    let http: HttpError;
    if (error instanceof HttpError) http = error;
    else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      http = new HttpError(413, 'payload_too_large', 'That request is too large.');
    } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') {
      http = new HttpError(400, 'invalid_input', 'The request was not valid JSON.');
    } else if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      http = new HttpError(404, 'not_found', 'Not found.');
    } else {
      http = new HttpError(500, 'internal', 'Something went wrong on our side. Try again.');
      logger.log('error', 'unhandled_error', { route: req.path, name: error instanceof Error ? error.name : 'unknown' });
    }
    if (http.status >= 400 && http.status !== 404) {
      logger.log(http.status >= 500 ? 'error' : 'warn', 'request_failed', { route: req.path, status: http.status, code: http.code });
    }
    if (http.retryAfterSeconds) res.setHeader('Retry-After', String(http.retryAfterSeconds));
    const body: ApiErrorBody = {
      error: {
        code: http.code,
        message: http.message,
        ...(http.fields ? { fields: http.fields } : {}),
        ...(http.retryAfterSeconds ? { retryAfterSeconds: http.retryAfterSeconds } : {}),
      },
    };
    res.status(http.status).json(body);
  });

  return app;
}
