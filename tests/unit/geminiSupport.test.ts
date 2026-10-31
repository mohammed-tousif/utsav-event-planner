import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { canFallBack, redact, toAiError } from '../../src/server/ai/geminiErrors';
import { contentsFor, readReply, type StructuredRequest } from '../../src/server/ai/geminiRequest';
import { BAD_MODE_TTL_MS, ModelHealth, OVERLOAD_COOLDOWN_MS, RATE_LIMIT_COOLDOWN_MS } from '../../src/server/ai/modelHealth';
import { AiError } from '../../src/server/ai/types';
import { AiRevisionSchema } from '../../src/shared/schemas';

describe('toAiError', () => {
  it.each([
    [429, 'rate_limited'],
    [401, 'not_configured'],
    [404, 'unavailable'],
    [503, 'unavailable'],
    [400, 'invalid_output'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(toAiError(new ApiError({ message: 'x', status }), undefined).kind).toBe(kind);
  });

  it('marks other client errors as a rejected request style so another style can be tried', () => {
    const error = toAiError(new ApiError({ message: 'Invalid JSON schema', status: 400 }), undefined);
    expect(error.diagnostics?.badRequest).toBe(true);
  });

  it('treats an invalid key as a configuration problem, not a request-style problem', () => {
    const error = toAiError(new ApiError({ message: 'API key not valid', status: 400 }), undefined);
    expect(error.kind).toBe('not_configured');
    expect(error.diagnostics?.badRequest).toBeUndefined();
  });

  it('reports cancellation, timeouts and network failures', () => {
    const cancelled = new AbortController();
    cancelled.abort();
    expect(toAiError(new Error('boom'), cancelled.signal).message).toBe('The request was cancelled.');
    expect(toAiError(Object.assign(new Error('x'), { name: 'TimeoutError' }), undefined).kind).toBe('timeout');
    expect(toAiError(new TypeError('fetch failed'), undefined).kind).toBe('unavailable');
  });

  it('only falls back to another model for errors another model could fix', () => {
    expect(canFallBack(new AiError('rate_limited', 'x'), undefined)).toBe(true);
    expect(canFallBack(new AiError('blocked', 'x'), undefined)).toBe(false);
    expect(canFallBack(new AiError('not_configured', 'x'), undefined)).toBe(false);
  });

  it('redacts anything that looks like a key', () => {
    const fakeKey = ['AI', 'za', 'Sy', 'B'.repeat(30)].join('');
    expect(redact(`failed for ${fakeKey} with key=${fakeKey}`)).not.toContain(fakeKey);
  });
});

describe('ModelHealth', () => {
  it('skips rate-limited models for ten minutes and overloaded ones for two', () => {
    let now = 0;
    const health = new ModelHealth(() => now);
    health.recordFailure('a', 'schema', new AiError('rate_limited', 'x'));
    health.recordFailure('b', 'schema', new AiError('unavailable', 'x', undefined, { status: 503 }));
    expect(health.readyModels(['a', 'b', 'c'])).toEqual(['c']);
    now = OVERLOAD_COOLDOWN_MS + 1;
    expect(health.readyModels(['a', 'b', 'c'])).toEqual(['b', 'c']);
    now = RATE_LIMIT_COOLDOWN_MS + 1;
    expect(health.readyModels(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('still tries every model when all of them are cooling down, and drops duplicates', () => {
    const health = new ModelHealth(() => 0);
    health.recordFailure('a', 'json', new AiError('timeout', 'x'));
    expect(health.readyModels(['a', 'a', ''])).toEqual(['a']);
  });

  it('remembers a rejected request style per model for an hour', () => {
    let now = 0;
    const health = new ModelHealth(() => now);
    health.recordFailure('a', 'schema-simple', new AiError('invalid_output', 'x', undefined, { badRequest: true }));
    expect(health.usableModes('a')).toEqual(['schema', 'json']);
    expect(health.usableModes('b')).toEqual(['schema-simple', 'schema', 'json']);
    now = BAD_MODE_TTL_MS + 1;
    expect(health.usableModes('a')).toEqual(['schema-simple', 'schema', 'json']);
  });
});

describe('Gemini request helpers', () => {
  const request: StructuredRequest<unknown> = {
    task: 'revise',
    systemInstruction: 'system',
    prompt: 'prompt',
    jsonSchema: { type: 'object' },
    schema: AiRevisionSchema,
    temperature: 0.4,
  };

  it('embeds the schema in the prompt only in plain JSON mode', () => {
    expect(contentsFor('schema', request)).toBe('prompt');
    expect(contentsFor('json', request)).toContain('"type":"object"');
  });

  it('rejects blocked, empty, non-JSON and off-schema replies with clear reasons', () => {
    expect(() => readReply({ text: '{}', blockReason: 'SAFETY' }, AiRevisionSchema)).toThrow(/declined/);
    expect(() => readReply({ text: undefined, finishReason: 'MAX_TOKENS' }, AiRevisionSchema)).toThrow(/cut off/);
    expect(() => readReply({ text: 'not json' }, AiRevisionSchema)).toThrow(/not valid JSON/);
    expect(() => readReply({ text: '{"understood": 4}' }, AiRevisionSchema)).toThrow(/expected plan structure/);
  });

  it('accepts JSON wrapped in a markdown fence', () => {
    const reply =
      '```json\n{"understood":"ok","totalBudget":100,"guestCount":10,"eventDate":"","style":"","adjustments":[],"lockCategories":[],"unlockCategories":[],"regenerateTasks":false,"regenerateSchedule":false,"regenerateVendors":false,"regenerateIdeas":false,"tasks":[],"schedule":[],"vendors":[],"ideas":[],"changeSummary":[],"tradeoffs":[]}\n```';
    expect(readReply({ text: reply }, AiRevisionSchema).data.understood).toBe('ok');
  });
});
