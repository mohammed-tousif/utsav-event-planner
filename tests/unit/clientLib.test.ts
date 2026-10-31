import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientApiError, generatePlan, revisePlan } from '../../src/client/lib/api';
import { fileSlug, planToIcs } from '../../src/client/lib/export';
import {
  clearDraft,
  deletePlan,
  listPlans,
  loadDraft,
  loadPlan,
  parsePlanJson,
  planTitle,
  saveDraft,
  savePlan,
  storageAvailable,
} from '../../src/client/lib/storage';
import { makeInput, makePlan } from '../fixtures';

/** A minimal in-memory localStorage that can be made to fail like a full or blocked one. */
class MemoryStorage {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites && !key.startsWith('__')) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe('plan storage', () => {
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: store });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves, lists, loads and deletes plans', () => {
    const plan = makePlan();
    expect(savePlan(plan)).toEqual({ ok: true });
    expect(listPlans()).toEqual([expect.objectContaining({ id: plan.id, title: 'Asha and Rohan’s wedding' })]);
    expect(loadPlan(plan.id)).toEqual({ ok: true, plan });
    deletePlan(plan.id);
    expect(listPlans()).toEqual([]);
    expect(loadPlan(plan.id)).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses corrupt or tampered plans instead of crashing', () => {
    store.setItem('utsav.plan.x', '{"id":"x"}');
    expect(loadPlan('x')).toEqual({ ok: false, reason: 'corrupt' });
    expect(parsePlanJson('not json')).toEqual({ ok: false, reason: 'corrupt' });
    store.setItem('utsav.index.v1', 'garbage');
    expect(listPlans()).toEqual([]);
  });

  it('reports a full browser storage', () => {
    store.failWrites = true;
    expect(savePlan(makePlan())).toEqual({ ok: false, reason: 'quota' });
  });

  it('keeps an unsent form draft and clears it', () => {
    saveDraft({ city: 'Hubballi' });
    expect(loadDraft()).toEqual({ city: 'Hubballi' });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('degrades gracefully when storage is blocked', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(storageAvailable()).toBe(false);
    expect(savePlan(makePlan())).toEqual({ ok: false, reason: 'unavailable' });
    expect(loadPlan('x')).toEqual({ ok: false, reason: 'unavailable' });
    expect(listPlans()).toEqual([]);
  });

  it('names untitled plans after the event', () => {
    expect(planTitle(makePlan(makeInput({ title: '' })))).toBe('Wedding in Hubballi, Karnataka');
  });
});

describe('exports', () => {
  it('builds a file name and a valid calendar with one event per task', () => {
    const plan = makePlan();
    expect(fileSlug(plan)).toBe('asha-and-rohan-s-wedding-2027-02-14');
    const ics = planToIcs(plan);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBeGreaterThanOrEqual(plan.timeline.tasks.length);
    expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
  });
});

describe('API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  it('posts the input with the device date and returns the plan', async () => {
    const plan = makePlan();
    respond(200, { plan, cached: false });
    const result = await generatePlan(plan.input);
    expect(result.plan.id).toBe(plan.id);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/plans');
    expect(JSON.parse(String(init?.body))).toMatchObject({ input: { guestCount: 250 }, clientToday: expect.any(String) });
  });

  it('does not send the previous prompt and reply back with a revision', async () => {
    const plan = makePlan();
    plan.meta.exchange = { kind: 'plan', model: 'm', at: 'now', prompt: 'p', reply: 'r' };
    respond(200, { plan, diff: {} });
    await revisePlan(plan, 'Reduce the budget by 20%');
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body));
    expect(body.plan.meta.exchange).toBeUndefined();
    expect(body.request).toBe('Reduce the budget by 20%');
  });

  it('turns API errors into typed errors with field messages and retry hints', async () => {
    respond(429, { error: { code: 'ai_rate_limited', message: 'Busy', retryAfterSeconds: 60, fields: { a: 'b' } } });
    const error = await generatePlan(makeInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientApiError);
    expect(error).toMatchObject({ code: 'ai_rate_limited', message: 'Busy', retryAfterSeconds: 60, fields: { a: 'b' }, retryable: true });
  });

  it('explains unreadable replies, network failures and cancellations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    );
    await expect(generatePlan(makeInput())).rejects.toMatchObject({ code: 'internal' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(generatePlan(makeInput())).rejects.toMatchObject({ code: 'network', retryable: true });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))),
    );
    await expect(generatePlan(makeInput(), controller.signal)).rejects.toMatchObject({ code: 'aborted', retryable: false });
  });
});
