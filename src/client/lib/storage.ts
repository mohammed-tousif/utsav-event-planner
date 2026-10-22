import { z } from 'zod';
import { PlanSchema, type EventInputDraft, type Plan } from '../../shared/schemas';

/**
 * Plans are stored only in this browser's localStorage. Every read is
 * validated, so corrupted or tampered data is skipped instead of crashing.
 */

const PLAN_PREFIX = 'utsav.plan.';
const INDEX_KEY = 'utsav.index.v1';
const DRAFT_KEY = 'utsav.draft.v1';
const MAX_PLANS = 30;

export interface PlanSummary {
  id: string;
  title: string;
  eventType: Plan['input']['eventType'];
  eventDate: string;
  updatedAt: string;
}

const SummarySchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    eventType: z.enum(['wedding', 'birthday', 'community']),
    eventDate: z.string(),
    updatedAt: z.string(),
  }),
);

function storage(): Storage | null {
  try {
    const store = window.localStorage;
    const probe = '__utsav_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function storageAvailable(): boolean {
  return storage() !== null;
}

export function planTitle(plan: Pick<Plan, 'input'>): string {
  if (plan.input.title) return plan.input.title;
  const name = plan.input.birthday?.honoreeName;
  if (plan.input.eventType === 'birthday') return name ? `${name}’s birthday` : 'Birthday party';
  if (plan.input.eventType === 'wedding') return `Wedding in ${plan.input.city}`;
  return `Community event in ${plan.input.city}`;
}

function readIndex(store: Storage): PlanSummary[] {
  try {
    const parsed = SummarySchema.safeParse(JSON.parse(store.getItem(INDEX_KEY) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function listPlans(): PlanSummary[] {
  const store = storage();
  if (!store) return [];
  return readIndex(store).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export type SaveResult = { ok: true } | { ok: false; reason: 'unavailable' | 'quota' };

export function savePlan(plan: Plan): SaveResult {
  const store = storage();
  if (!store) return { ok: false, reason: 'unavailable' };
  try {
    store.setItem(PLAN_PREFIX + plan.id, JSON.stringify(plan));
    const summary: PlanSummary = {
      id: plan.id,
      title: planTitle(plan),
      eventType: plan.input.eventType,
      eventDate: plan.input.eventDate,
      updatedAt: plan.updatedAt,
    };
    const index = [summary, ...readIndex(store).filter((p) => p.id !== plan.id)];
    for (const old of index.slice(MAX_PLANS)) store.removeItem(PLAN_PREFIX + old.id);
    store.setItem(INDEX_KEY, JSON.stringify(index.slice(0, MAX_PLANS)));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'quota' };
  }
}

export type LoadResult = { ok: true; plan: Plan } | { ok: false; reason: 'missing' | 'corrupt' | 'unavailable' };

export function loadPlan(id: string): LoadResult {
  const store = storage();
  if (!store) return { ok: false, reason: 'unavailable' };
  const raw = store.getItem(PLAN_PREFIX + id);
  if (!raw) return { ok: false, reason: 'missing' };
  return parsePlanJson(raw);
}

export function parsePlanJson(raw: string): { ok: true; plan: Plan } | { ok: false; reason: 'corrupt' } {
  try {
    const parsed = PlanSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { ok: true, plan: parsed.data } : { ok: false, reason: 'corrupt' };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

export function deletePlan(id: string): void {
  const store = storage();
  if (!store) return;
  store.removeItem(PLAN_PREFIX + id);
  store.setItem(INDEX_KEY, JSON.stringify(readIndex(store).filter((p) => p.id !== id)));
}

export function saveDraft(draft: Partial<EventInputDraft>): void {
  try {
    storage()?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* drafts are a convenience; ignore failures */
  }
}

export function loadDraft(): Partial<EventInputDraft> | null {
  try {
    const raw = storage()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Partial<EventInputDraft>) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
