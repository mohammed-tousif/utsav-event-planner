import { Router, type RequestHandler } from 'express';
import type { GenerateResponse, ReviseResponse } from '../../shared/api';
import { assemblePlan } from '../../shared/plan';
import { applyRevision } from '../../shared/revision';
import {
  GenerateRequestSchema,
  ReviseRequestSchema,
  type AiExchange,
  type EventInput,
  type Plan,
  type PlanMeta,
} from '../../shared/schemas';
import { checkEventDate } from '../../shared/timeline';
import type { AiProvider, AiResult } from '../ai/types';
import { hashKey, TtlCache } from '../cache';
import { toHttpError } from '../http/errors';
import { abortOnClose, parseBody, resolveToday } from '../http/request';

const PLAN_CACHE_SIZE = 100;
const PLAN_CACHE_TTL_MS = 30 * 60_000;
/** Size caps for the prompt/reply kept on each plan for the transparency panel. */
const MAX_EXCHANGE_PROMPT = 24_000;
const MAX_EXCHANGE_REPLY = 60_000;

export interface PlanRouteDeps {
  provider: AiProvider;
  aiLimiter: RequestHandler;
  now: () => Date;
}

function exchangeOf(kind: AiExchange['kind'], result: AiResult<unknown>, at: string): AiExchange {
  return {
    kind,
    model: result.model,
    at,
    prompt: result.exchange.prompt.slice(0, MAX_EXCHANGE_PROMPT),
    reply: result.exchange.reply.slice(0, MAX_EXCHANGE_REPLY),
  };
}

/** Runs domain work, converting planning and AI errors into HTTP errors. */
async function asHttp<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toHttpError(error);
  }
}

/** POST /api/plans and POST /api/plans/revise. */
export function planRoutes({ provider, aiLimiter, now }: PlanRouteDeps): Router {
  const router = Router();
  const cache = new TtlCache<Plan>(PLAN_CACHE_SIZE, PLAN_CACHE_TTL_MS);
  const isSample = provider.name === 'sample';

  async function generate(input: EventInput, today: string, signal: AbortSignal): Promise<Plan> {
    checkEventDate(input.eventDate, today);
    const result = await provider.generatePlan(input, today, signal);
    const generatedAt = now().toISOString();
    const meta: PlanMeta = {
      source: isSample ? 'sample' : 'ai',
      provider: isSample ? 'Sample data' : 'Google Gemini',
      model: result.model,
      generatedAt,
      exchange: exchangeOf('plan', result, generatedAt),
    };
    return assemblePlan(input, result.data, meta, today);
  }

  async function revise(plan: Plan, request: string, today: string, signal: AbortSignal) {
    const result = await provider.revisePlan(plan, request, today, signal);
    const applied = applyRevision(plan, result.data, request, today);
    applied.plan.meta = { ...applied.plan.meta, model: result.model, exchange: exchangeOf('revision', result, now().toISOString()) };
    return applied;
  }

  router.post('/plans', aiLimiter, async (req, res) => {
    const { input, clientToday } = parseBody(GenerateRequestSchema, req.body);
    const today = resolveToday(clientToday, now());
    // Identical requests on the same day reuse the plan instead of calling the AI again.
    const key = hashKey({ input, today, model: provider.model });
    const cached = cache.get(key);
    if (cached) {
      const body: GenerateResponse = { plan: { ...cached, id: globalThis.crypto.randomUUID() }, cached: true };
      res.json(body);
      return;
    }
    const plan = await asHttp(() => generate(input, today, abortOnClose(res)));
    cache.set(key, plan);
    const body: GenerateResponse = { plan, cached: false };
    res.json(body);
  });

  router.post('/plans/revise', aiLimiter, async (req, res) => {
    const { plan, request, clientToday } = parseBody(ReviseRequestSchema, req.body);
    const today = resolveToday(clientToday, now());
    const body: ReviseResponse = await asHttp(() => revise(plan, request, today, abortOnClose(res)));
    res.json(body);
  });

  return router;
}
