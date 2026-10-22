import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from '@google/genai';
import type { z } from 'zod';
import { AiPlanDraftSchema, AiRevisionSchema, type EventInput, type Plan } from '../../shared/schemas';
import type { ServerConfig } from '../config';
import type { Logger } from '../logger';
import { simplifySchema, toGeminiSchema } from './jsonSchema';
import { normalizeModelJson } from './normalize';
import { PLAN_SYSTEM, REVISE_SYSTEM, planPrompt, revisePrompt } from './prompts';
import { AiError, type AiProvider, type AiResult } from './types';

const PLAN_DESCRIPTIONS: Record<string, string> = {
  contingencyPct: 'Percentage of the total kept aside for surprises, 5 to 15.',
  'adjustments[].factor': 'Multiplier relative to a typical event, 0.5 to 1.6.',
  'tasks[].offsetDays': 'Ideal number of days before the event to finish this task. 0 means on the event day.',
  'schedule[].time': 'Start time in 24-hour HH:MM format.',
  'schedule[].segment': 'Function, day or part of the event this item belongs to.',
  'ideas[].estimatedCost': 'Rough total cost in the event currency.',
};

const REVISION_DESCRIPTIONS: Record<string, string> = {
  ...PLAN_DESCRIPTIONS,
  eventDate: 'Event date in YYYY-MM-DD format.',
  'adjustments[].factor': 'Multiplier relative to the current plan, 0.5 to 1.6.',
};

/** After a quota error, a model is skipped for this long. */
export const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

/** Content that every model reply must pass before the app uses it. */
type Schema<T> = z.ZodType<T>;

/**
 * Request styles, tried in order: Gemini structured output with the full
 * schema and a thinking level; structured output with a simplified schema and
 * the model's default thinking; plain JSON output with the schema in the prompt. A style the API rejects (HTTP 400)
 * for a model is remembered and skipped for an hour.
 */
const CALL_MODES = ['schema', 'schema-simple', 'json'] as const;
type CallMode = (typeof CALL_MODES)[number];
const BAD_MODE_TTL_MS = 60 * 60_000;
/** After an overload (HTTP 503), a model is skipped for this long. */
export const OVERLOAD_COOLDOWN_MS = 2 * 60_000;

export interface GeminiClient {
  generate(model: string, contents: string, config: GenerateContentConfig): Promise<{ text: string | undefined; blockReason?: string; finishReason?: string }>;
}

export function createGoogleClient(apiKey: string): GeminiClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate(model, contents, config) {
      const response = await ai.models.generateContent({ model, contents, config });
      return {
        text: response.text,
        blockReason: response.promptFeedback?.blockReason,
        finishReason: response.candidates?.[0]?.finishReason,
      };
    },
  };
}

function mapThinking(level: ServerConfig['gemini']['thinkingLevel']): GenerateContentConfig['thinkingConfig'] {
  if (level === 'OFF') return undefined;
  return { thinkingLevel: ThinkingLevel[level] };
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(trimmed);
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  readonly configured: boolean;
  private readonly cooldownUntil = new Map<string, number>();
  private readonly badModeUntil = new Map<string, number>();
  private readonly planSchema = toGeminiSchema(AiPlanDraftSchema, PLAN_DESCRIPTIONS);
  private readonly revisionSchema = toGeminiSchema(AiRevisionSchema, REVISION_DESCRIPTIONS);

  constructor(
    private readonly config: ServerConfig['gemini'],
    private readonly logger: Logger,
    private readonly client: GeminiClient | null = config.apiKey ? createGoogleClient(config.apiKey) : null,
    private readonly now: () => number = Date.now,
  ) {
    this.model = config.model;
    this.configured = Boolean(client);
  }

  generatePlan(input: EventInput, today: string, signal?: AbortSignal) {
    return this.call('plan', PLAN_SYSTEM, planPrompt(input, today), this.planSchema, AiPlanDraftSchema, signal, 0.7);
  }

  revisePlan(plan: Plan, request: string, today: string, signal?: AbortSignal) {
    return this.call('revise', REVISE_SYSTEM, revisePrompt(plan, request, today), this.revisionSchema, AiRevisionSchema, signal, 0.4);
  }

  /**
   * One structured call with a bounded recovery path:
   * - a malformed reply is retried once on the same model;
   * - if the API rejects the request itself (HTTP 400), the next request style
   *   is tried (see CALL_MODES) and the rejected style is skipped for a while;
   * - quota, availability and output errors move on to the next fallback model.
   * Every reply is validated with zod before it is used.
   */
  private async call<T>(
    task: 'plan' | 'revise',
    systemInstruction: string,
    prompt: string,
    jsonSchema: unknown,
    schema: Schema<T>,
    signal: AbortSignal | undefined,
    temperature: number,
  ): Promise<AiResult<T>> {
    if (!this.client) throw new AiError('not_configured', 'The AI planner is not configured on this server yet.');
    const configured = [this.config.model, ...this.config.fallbackModels].filter((m, i, all) => m && all.indexOf(m) === i);
    // Skip a model that recently hit its quota, unless every model has.
    const ready = configured.filter((m) => (this.cooldownUntil.get(m) ?? 0) <= this.now());
    const models = ready.length ? ready : configured;
    let lastError: AiError | undefined;

    for (const [modelIndex, model] of models.entries()) {
      const modes = CALL_MODES.filter((m) => (this.badModeUntil.get(`${model}:${m}`) ?? 0) <= this.now());
      let modeIndex = 0;
      let retriedOutput = false;
      while (modeIndex < modes.length) {
        const mode = modes[modeIndex]!;
        const started = Date.now();
        try {
          const data = await this.once(model, mode, systemInstruction, prompt, jsonSchema, schema, signal, temperature);
          this.logger.log('info', 'ai_call', { task, model, mode, ms: Date.now() - started, ok: true });
          return { data, model };
        } catch (error) {
          const mapped = this.mapError(error, signal);
          this.logger.log('warn', 'ai_call', {
            task,
            model,
            mode,
            ms: Date.now() - started,
            ok: false,
            kind: mapped.kind,
            status: mapped.diagnostics?.status,
            reason: mapped.diagnostics?.reason,
          });
          lastError = mapped;
          if (mapped.kind === 'rate_limited') this.cooldownUntil.set(model, this.now() + RATE_LIMIT_COOLDOWN_MS);
          if (mapped.diagnostics?.status === 503) this.cooldownUntil.set(model, this.now() + OVERLOAD_COOLDOWN_MS);
          if (mapped.diagnostics?.badRequest) {
            this.badModeUntil.set(`${model}:${mode}`, this.now() + BAD_MODE_TTL_MS);
            modeIndex += 1;
            continue;
          }
          if (mapped.kind === 'invalid_output' && !retriedOutput) {
            retriedOutput = true;
            continue;
          }
          break;
        }
      }
      const canFallBack =
        lastError && ['rate_limited', 'unavailable', 'invalid_output', 'timeout'].includes(lastError.kind) && !signal?.aborted;
      if (!canFallBack || modelIndex === models.length - 1) break;
    }
    throw lastError ?? new AiError('unavailable', 'The AI planner did not respond.');
  }

  private async once<T>(
    model: string,
    mode: CallMode,
    systemInstruction: string,
    prompt: string,
    jsonSchema: unknown,
    schema: Schema<T>,
    signal: AbortSignal | undefined,
    temperature: number,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const shared: GenerateContentConfig = {
      systemInstruction,
      temperature,
      maxOutputTokens: 16_000,
      responseMimeType: 'application/json',
      abortSignal: combined,
      httpOptions: { timeout: this.config.timeoutMs },
    };
    const config: GenerateContentConfig =
      mode === 'schema'
        ? { ...shared, responseJsonSchema: jsonSchema, thinkingConfig: mapThinking(this.config.thinkingLevel) }
        : mode === 'schema-simple'
          ? { ...shared, responseJsonSchema: simplifySchema(jsonSchema) }
          : shared;
    const contents =
      mode === 'json' ? `${prompt}\n\nReturn only a JSON object that matches this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}` : prompt;
    const result = await this.client!.generate(model, contents, config);
    if (result.blockReason) throw new AiError('blocked', 'The AI declined this request. Rephrase it and try again.');
    if (!result.text) {
      throw new AiError(
        'invalid_output',
        result.finishReason === 'MAX_TOKENS' ? 'The AI reply was cut off.' : 'The AI returned an empty reply.',
        undefined,
        { reason: `empty reply, finishReason=${result.finishReason ?? 'none'}` },
      );
    }
    let json: unknown;
    try {
      json = parseJson(result.text);
    } catch {
      throw new AiError('invalid_output', 'The AI reply was not valid JSON.', undefined, { reason: `unparseable JSON (${result.text.length} chars)` });
    }
    const parsed = schema.safeParse(normalizeModelJson(json));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AiError('invalid_output', 'The AI reply did not match the expected plan structure.', undefined, {
        reason: `schema mismatch at ${first?.path.join('.') || 'root'}: ${first?.message ?? ''}`.slice(0, 200),
      });
    }
    return parsed.data;
  }

  private mapError(error: unknown, signal: AbortSignal | undefined): AiError {
    if (error instanceof AiError) return error;
    if (signal?.aborted) return new AiError('timeout', 'The request was cancelled.');
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /timed? ?out|aborted/i.test(error.message))) {
      return new AiError('timeout', 'The AI took too long to answer. Try again.', undefined, { reason: error.name });
    }
    if (error instanceof ApiError) {
      const diagnostics = { status: error.status, reason: redact(error.message) };
      if (error.status === 429) {
        return new AiError('rate_limited', 'The AI is busy or the free quota is used up. Wait a minute and try again.', 60, diagnostics);
      }
      if ((error.status === 400 && /api[ _-]?key/i.test(error.message)) || error.status === 401 || error.status === 403) {
        return new AiError('not_configured', 'The AI key on the server is not valid.', undefined, diagnostics);
      }
      if (error.status === 404) return new AiError('unavailable', 'The configured AI model is not available.', undefined, diagnostics);
      if (error.status >= 500) return new AiError('unavailable', 'The AI service is having problems. Try again shortly.', undefined, diagnostics);
      return new AiError('invalid_output', 'The AI could not process this request.', undefined, { ...diagnostics, badRequest: true });
    }
    const reason = error instanceof Error ? redact(`${error.name}: ${error.message}`) : 'unknown error';
    return new AiError('unavailable', 'Could not reach the AI service.', undefined, { reason });
  }
}

/** Keeps provider error text short and free of anything that looks like a key. */
export function redact(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/key=[^&\s]+/gi, 'key=[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}
