import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { ApiErrorBody } from '../../shared/api';
import type { ServerConfig } from '../config';

/** Strict CSP (same-origin only, no inline code), no referrer, no framing, no device APIs. */
export function securityHeaders(config: ServerConfig): RequestHandler[] {
  return [
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
    (_req, res, next) => {
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
      next();
    },
  ];
}

/** Per-IP limit on the routes that call the AI, which cost money and quota. */
export function aiRateLimit(config: ServerConfig): RequestHandler {
  return rateLimit({
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
}
