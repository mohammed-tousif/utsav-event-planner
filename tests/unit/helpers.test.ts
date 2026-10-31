import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { bookByLabel, daysToGoLabel, dueLabel, formatLongDate, formatShortDate, formatTime, pct } from '../../src/client/lib/format';
import { SampleProvider } from '../../src/server/ai/sample';
import { createApp } from '../../src/server/app';
import { hashKey, TtlCache } from '../../src/server/cache';
import { loadConfig } from '../../src/server/config';
import { consoleLogger, silentLogger } from '../../src/server/logger';
import { describeEvent } from '../../src/server/ai/prompts';
import { formatMoney, formatMoneyDelta, roundingStep } from '../../src/shared/money';
import { makeInput, TODAY } from '../fixtures';

describe('date and number labels', () => {
  it('formats dates in Indian English, independent of time zone', () => {
    expect(formatLongDate('2027-02-14')).toBe('Sun, 14 February 2027');
    expect(formatShortDate('2026-11-06')).toBe('6 Nov');
    expect(formatShortDate('2026-11-06', true)).toBe('6 Nov 2026');
  });

  it.each([
    ['2026-10-20', '2 days ago'],
    ['2026-10-22', 'Today'],
    ['2026-10-23', 'Tomorrow'],
    ['2026-11-01', 'In 10 days'],
    ['2027-02-14', 'In about 4 months'],
  ])('labels %s relative to today', (date, label) => {
    expect(daysToGoLabel(date, TODAY)).toBe(label);
  });

  it('labels task and booking deadlines with an urgency tone', () => {
    expect(dueLabel('2026-10-21', TODAY)).toEqual({ text: 'Overdue by 1 day', tone: 'overdue' });
    expect(dueLabel(TODAY, TODAY)).toEqual({ text: 'Due today', tone: 'soon' });
    expect(dueLabel('2026-10-25', TODAY)).toEqual({ text: 'Due in 3 days', tone: 'soon' });
    expect(dueLabel('2026-12-04', TODAY)).toEqual({ text: 'Due 4 Dec 2026', tone: 'later' });
    expect(bookByLabel('2026-10-19', TODAY)).toEqual({ text: 'Booking deadline passed 3 days ago', tone: 'overdue' });
    expect(bookByLabel(TODAY, TODAY).text).toBe('Book today');
    expect(bookByLabel('2026-10-23', TODAY).text).toBe('Book within 1 day');
    expect(bookByLabel('2026-12-04', TODAY).text).toBe('Book by 4 Dec 2026');
  });

  it('formats times, shares and money', () => {
    expect(formatTime('00:05')).toBe('12:05 am');
    expect(formatTime('19:30')).toBe('7:30 pm');
    expect(pct(1, 3)).toBe('33.3%');
    expect(pct(1, 0)).toBe('0%');
    expect(formatMoney(1_500_000, 'INR')).toBe('₹15,00,000');
    expect(formatMoneyDelta(-32_500, 'INR')).toBe('−₹32,500');
    expect(formatMoneyDelta(0, 'USD')).toBe('$0');
    expect(formatMoneyDelta(12, 'USD')).toBe('+$12');
  });

  it('rounds to tidy steps that shrink with the budget', () => {
    expect([roundingStep('INR', 1_500_000), roundingStep('INR', 50_000), roundingStep('INR', 5_000), roundingStep('INR', 500)]).toEqual([
      500, 100, 10, 1,
    ]);
    expect([roundingStep('USD', 50_000), roundingStep('USD', 5_000), roundingStep('USD', 500)]).toEqual([10, 5, 1]);
  });
});

describe('TtlCache', () => {
  it('expires entries and evicts the least recently used one', () => {
    let now = 0;
    const cache = new TtlCache<string>(2, 1_000, () => now);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.get('a')).toBe('1'); // "a" is now the most recent
    cache.set('c', '3');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(2);
    now = 1_001;
    expect(cache.get('a')).toBeUndefined();
  });

  it('hashes objects the same way regardless of key order', () => {
    expect(hashKey({ a: 1, b: [2, { c: 3 }] })).toBe(hashKey({ b: [2, { c: 3 }], a: 1 }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });
});

describe('server helpers', () => {
  it('logs one JSON line per event, errors to stderr', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger.log('info', 'started', { port: 8080 });
    consoleLogger.log('error', 'failed');
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ severity: 'INFO', event: 'started', port: 8080 });
    expect(JSON.parse(String(err.mock.calls[0]?.[0]))).toMatchObject({ severity: 'ERROR', event: 'failed' });
    out.mockRestore();
    err.mockRestore();
  });

  it('describes birthday and community details in prompts', () => {
    const birthday = makeInput({
      eventType: 'birthday',
      wedding: undefined,
      birthday: { ageGroup: 'child', audience: 'mixed', honoreeName: 'Meera' },
    });
    expect(describeEvent(birthday, TODAY)).toContain('<user_text>Meera</user_text>');
    const community = makeInput({
      eventType: 'community',
      wedding: undefined,
      community: { format: 'festival', setting: 'outdoor', entry: 'free' },
    });
    expect(describeEvent(community, TODAY)).toMatch(/Format: .+ Setting: .+ Entry: /);
  });

  it('serves the built app with long-lived assets and an SPA fallback', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'utsav-static-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Utsav</title>');
    writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
    const config = loadConfig({ NODE_ENV: 'test', AI_PROVIDER: 'sample' });
    const app = createApp({ config, provider: new SampleProvider(), logger: silentLogger, staticDir: dir });

    const page = await request(app).get('/plan/abc').expect(200);
    expect(page.text).toContain('<title>Utsav</title>');
    expect(page.headers['cache-control']).toBe('no-cache');
    const asset = await request(app).get('/assets/app.js').expect(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    await request(app).get('/assets/missing.js').expect(404);
  });
});
