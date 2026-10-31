import type { AiError } from './types';

/**
 * Request styles, tried in order: Gemini structured output with a simplified
 * schema (no size limits or descriptions) and the model's default thinking;
 * structured output with the full schema and a thinking level; plain JSON
 * output with the full schema in the prompt. Every style is validated against
 * the full zod schema afterwards.
 */
export const CALL_MODES = ['schema-simple', 'schema', 'json'] as const;
export type CallMode = (typeof CALL_MODES)[number];

/** After a quota error, a model is skipped for this long. */
export const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
/** After an overload or a timeout (HTTP 503/504), a model is skipped for this long. */
export const OVERLOAD_COOLDOWN_MS = 2 * 60_000;
/** A request style the API rejected (HTTP 400) for a model is skipped for this long. */
export const BAD_MODE_TTL_MS = 60 * 60_000;

/**
 * Remembers which models are temporarily unhealthy and which request styles a
 * model has rejected, so later calls skip them instead of failing again.
 */
export class ModelHealth {
  private readonly cooldownUntil = new Map<string, number>();
  private readonly badModeUntil = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Models not cooling down, in order; all of them if every model is cooling down. */
  readyModels(models: readonly string[]): string[] {
    const unique = models.filter((m, i, all) => m && all.indexOf(m) === i);
    const ready = unique.filter((m) => (this.cooldownUntil.get(m) ?? 0) <= this.now());
    return ready.length ? ready : unique;
  }

  usableModes(model: string): CallMode[] {
    return CALL_MODES.filter((mode) => (this.badModeUntil.get(`${model}:${mode}`) ?? 0) <= this.now());
  }

  recordFailure(model: string, mode: CallMode, error: AiError): void {
    const status = error.diagnostics?.status;
    if (error.kind === 'rate_limited') this.cooldownUntil.set(model, this.now() + RATE_LIMIT_COOLDOWN_MS);
    if (status === 503 || status === 504 || error.kind === 'timeout') this.cooldownUntil.set(model, this.now() + OVERLOAD_COOLDOWN_MS);
    if (error.diagnostics?.badRequest) this.badModeUntil.set(`${model}:${mode}`, this.now() + BAD_MODE_TTL_MS);
  }
}
