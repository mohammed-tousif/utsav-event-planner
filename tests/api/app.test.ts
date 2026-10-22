import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { SampleProvider } from '../../src/server/ai/sample';
import { AiError, type AiProvider } from '../../src/server/ai/types';
import { createApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { silentLogger } from '../../src/server/logger';
import { addDays } from '../../src/shared/dates';
import { makeInput, TODAY } from '../fixtures';

const NOW = new Date(`${TODAY}T09:00:00Z`);

function appWith(provider: AiProvider = new SampleProvider(), env: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'sample', RATE_LIMIT_MAX_AI: '50', ...env });
  return createApp({ config, provider, logger: silentLogger, now: () => NOW });
}

const body = (overrides = {}) => ({ input: makeInput(), clientToday: TODAY, ...overrides });

describe('GET /api/status', () => {
  it('reports the provider without exposing configuration secrets', async () => {
    const res = await request(appWith()).get('/api/status').expect(200);
    expect(res.body).toMatchObject({ ok: true, ai: { provider: 'sample', sampleData: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/key/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends security headers', async () => {
    const res = await request(appWith()).get('/api/status');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('POST /api/plans', () => {
  it('creates a complete, labelled plan', async () => {
    const res = await request(appWith()).post('/api/plans').send(body()).expect(200);
    const { plan } = res.body;
    expect(plan.meta).toMatchObject({ source: 'sample', provider: 'Sample data' });
    expect(plan.budget.lines.reduce((s: number, l: { amount: number }) => s + l.amount, 0) + plan.budget.contingency).toBe(1_500_000);
    expect(plan.timeline.tasks.length).toBeGreaterThan(0);
    expect(plan.vendors.length).toBeGreaterThan(0);
    expect(plan.ideas.length).toBeGreaterThan(0);
  });

  it('returns field errors for invalid input', async () => {
    const res = await request(appWith())
      .post('/api/plans')
      .send(body({ input: { ...makeInput(), guestCount: -3, totalBudget: 0 } }))
      .expect(400);
    expect(res.body.error.code).toBe('invalid_input');
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['guestCount', 'totalBudget']));
  });

  it('rejects past event dates', async () => {
    const res = await request(appWith()).post('/api/plans').send(body({ input: makeInput({ eventDate: '2026-10-01' }) })).expect(400);
    expect(res.body.error.code).toBe('invalid_date');
  });

  it('accepts an event today', async () => {
    await request(appWith()).post('/api/plans').send(body({ input: makeInput({ eventDate: TODAY }) })).expect(200);
  });

  it('rejects a device date far from the real date', async () => {
    const res = await request(appWith()).post('/api/plans').send(body({ clientToday: addDays(TODAY, 5) })).expect(400);
    expect(res.body.error.fields.clientToday).toBeDefined();
  });

  it('serves an identical request from cache without calling the AI again', async () => {
    const provider = new SampleProvider();
    const spy = vi.spyOn(provider, 'generatePlan');
    const app = appWith(provider);
    const first = await request(app).post('/api/plans').send(body()).expect(200);
    const second = await request(app).post('/api/plans').send(body()).expect(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.body.cached).toBe(true);
    expect(second.body.plan.id).not.toBe(first.body.plan.id);
  });

  it.each([
    ['rate_limited', 429, 'ai_rate_limited'],
    ['timeout', 504, 'ai_timeout'],
    ['invalid_output', 502, 'ai_invalid_output'],
    ['not_configured', 503, 'ai_not_configured'],
    ['unavailable', 503, 'ai_unavailable'],
  ] as const)('maps provider %s to HTTP %i', async (kind, status, code) => {
    const failing: AiProvider = {
      name: 'gemini',
      model: 'test',
      configured: true,
      generatePlan: () => Promise.reject(new AiError(kind, 'AI failed.', kind === 'rate_limited' ? 60 : undefined)),
      revisePlan: () => Promise.reject(new AiError(kind, 'AI failed.')),
    };
    const res = await request(appWith(failing)).post('/api/plans').send(body()).expect(status);
    expect(res.body.error.code).toBe(code);
    if (kind === 'rate_limited') expect(res.headers['retry-after']).toBe('60');
  });

  it('hides unexpected errors behind a generic message', async () => {
    const broken: AiProvider = {
      name: 'gemini',
      model: 'test',
      configured: true,
      generatePlan: () => Promise.reject(new Error('internal stack detail with secret-ish info')),
      revisePlan: () => Promise.reject(new Error('x')),
    };
    const res = await request(appWith(broken)).post('/api/plans').send(body()).expect(500);
    expect(res.body.error.message).not.toContain('secret');
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    await request(appWith()).post('/api/plans').set('Content-Type', 'application/json').send('{"input":').expect(400);
    const huge = { ...body(), padding: 'x'.repeat(300_000) };
    const res = await request(appWith()).post('/api/plans').send(huge).expect(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });

  it('rate limits AI requests per client', async () => {
    const app = appWith(new SampleProvider(), { RATE_LIMIT_MAX_AI: '2' });
    await request(app).post('/api/plans').send(body()).expect(200);
    await request(app).post('/api/plans').send(body()).expect(200);
    const res = await request(app).post('/api/plans').send(body()).expect(429);
    expect(res.body.error.code).toBe('rate_limited');
  });
});

describe('POST /api/plans/revise', () => {
  async function createPlan(app = appWith()) {
    return (await request(app).post('/api/plans').send(body())).body.plan;
  }

  it('applies a revision and returns a diff', async () => {
    const app = appWith();
    const plan = await createPlan(app);
    const res = await request(app)
      .post('/api/plans/revise')
      .send({ plan, request: 'Reduce the budget by 20%', clientToday: TODAY })
      .expect(200);
    expect(res.body.plan.budget.total).toBe(1_200_000);
    expect(res.body.diff).toMatchObject({ totalBefore: 1_500_000, totalAfter: 1_200_000 });
    expect(res.body.plan.revisions).toHaveLength(1);
  });

  it('explains when a request changes nothing', async () => {
    const app = appWith();
    const plan = await createPlan(app);
    const res = await request(app).post('/api/plans/revise').send({ plan, request: 'What is the weather?', clientToday: TODAY }).expect(422);
    expect(res.body.error.code).toBe('no_change');
  });

  it('rejects an empty request and a tampered plan', async () => {
    const app = appWith();
    const plan = await createPlan(app);
    await request(app).post('/api/plans/revise').send({ plan, request: '  ', clientToday: TODAY }).expect(400);
    const tampered = { ...plan, budget: { ...plan.budget, total: -10 } };
    await request(app).post('/api/plans/revise').send({ plan: tampered, request: 'Reduce the budget by 20%', clientToday: TODAY }).expect(400);
  });
});

describe('unknown routes', () => {
  it('returns JSON 404s under /api', async () => {
    const res = await request(appWith()).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('loadConfig', () => {
  it('never falls back to sample data silently in production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).provider).toBe('gemini');
    expect(loadConfig({ NODE_ENV: 'development' }).provider).toBe('sample');
    expect(loadConfig({ NODE_ENV: 'production', AI_PROVIDER: 'sample' }).provider).toBe('sample');
    expect(loadConfig({ GEMINI_API_KEY: 'k' }).provider).toBe('gemini');
  });

  it('clamps numeric settings', () => {
    const config = loadConfig({ PORT: '99999999', GEMINI_TIMEOUT_MS: '1', GEMINI_THINKING_LEVEL: 'weird' });
    expect(config.port).toBe(65535);
    expect(config.gemini.timeoutMs).toBe(5000);
    expect(config.gemini.thinkingLevel).toBe('LOW');
  });
});
