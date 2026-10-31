import { GoogleGenAI, type GenerateContentConfig } from '@google/genai';
import { AiPlanDraftSchema, AiRevisionSchema, type EventInput, type Plan } from '../../shared/schemas';
import type { ServerConfig } from '../config';
import type { Logger } from '../logger';
import { canFallBack, toAiError } from './geminiErrors';
import { configFor, contentsFor, readReply, type ModelReply, type StructuredRequest } from './geminiRequest';
import { toGeminiSchema } from './jsonSchema';
import { ModelHealth, type CallMode } from './modelHealth';
import { PLAN_SYSTEM, REVISE_SYSTEM, planPrompt, revisePrompt } from './prompts';
import { AiError, type AiProvider, type AiResult } from './types';

export { redact } from './geminiErrors';
export { OVERLOAD_COOLDOWN_MS, RATE_LIMIT_COOLDOWN_MS } from './modelHealth';

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

/** Plans get a little creative freedom; revisions should stick closely to the request. */
const PLAN_TEMPERATURE = 0.7;
const REVISE_TEMPERATURE = 0.4;

export interface GeminiClient {
  generate(model: string, contents: string, config: GenerateContentConfig): Promise<ModelReply>;
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

type Outcome<T> = { ok: true; result: AiResult<T> } | { ok: false; error: AiError };

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly model: string;
  readonly configured: boolean;
  private readonly health: ModelHealth;
  private readonly planSchema = toGeminiSchema(AiPlanDraftSchema, PLAN_DESCRIPTIONS);
  private readonly revisionSchema = toGeminiSchema(AiRevisionSchema, REVISION_DESCRIPTIONS);

  constructor(
    private readonly config: ServerConfig['gemini'],
    private readonly logger: Logger,
    private readonly client: GeminiClient | null = config.apiKey ? createGoogleClient(config.apiKey) : null,
    now: () => number = Date.now,
  ) {
    this.model = config.model;
    this.configured = Boolean(client);
    this.health = new ModelHealth(now);
  }

  generatePlan(input: EventInput, today: string, signal?: AbortSignal) {
    return this.call({
      task: 'plan',
      systemInstruction: PLAN_SYSTEM,
      prompt: planPrompt(input, today),
      jsonSchema: this.planSchema,
      schema: AiPlanDraftSchema,
      temperature: PLAN_TEMPERATURE,
      signal,
    });
  }

  revisePlan(plan: Plan, request: string, today: string, signal?: AbortSignal) {
    return this.call({
      task: 'revise',
      systemInstruction: REVISE_SYSTEM,
      prompt: revisePrompt(plan, request, today),
      jsonSchema: this.revisionSchema,
      schema: AiRevisionSchema,
      temperature: REVISE_TEMPERATURE,
      signal,
    });
  }

  /**
   * One structured call with a bounded recovery path:
   * - a malformed reply is retried once on the same model;
   * - if the API rejects the request itself (HTTP 400), the next request style
   *   is tried and the rejected style is skipped for a while;
   * - quota, availability, timeout and output errors move on to the next
   *   fallback model.
   * Every reply is validated with zod before it is used.
   */
  private async call<T>(request: StructuredRequest<T>): Promise<AiResult<T>> {
    if (!this.client) throw new AiError('not_configured', 'The AI planner is not configured on this server yet.');
    const models = this.health.readyModels([this.config.model, ...this.config.fallbackModels]);
    let lastError: AiError | undefined;
    for (const model of models) {
      const outcome = await this.tryModel(model, request);
      if (outcome.ok) return outcome.result;
      lastError = outcome.error;
      if (!canFallBack(lastError, request.signal)) break;
    }
    throw lastError ?? new AiError('unavailable', 'The AI planner did not respond.');
  }

  /** Tries the request styles this model still accepts, retrying malformed output once. */
  private async tryModel<T>(model: string, request: StructuredRequest<T>): Promise<Outcome<T>> {
    const modes = this.health.usableModes(model);
    let lastError = new AiError('unavailable', 'The AI planner did not respond.');
    let retriedOutput = false;
    for (let index = 0; index < modes.length;) {
      const outcome = await this.attempt(model, modes[index]!, request);
      if (outcome.ok) return outcome;
      lastError = outcome.error;
      if (lastError.diagnostics?.badRequest) index += 1;
      else if (lastError.kind === 'invalid_output' && !retriedOutput) retriedOutput = true;
      else break;
    }
    return { ok: false, error: lastError };
  }

  private async attempt<T>(model: string, mode: CallMode, request: StructuredRequest<T>): Promise<Outcome<T>> {
    const started = Date.now();
    const contents = contentsFor(mode, request);
    try {
      const reply = await this.client!.generate(model, contents, configFor(mode, request, this.config));
      const { data, text } = readReply(reply, request.schema);
      this.logger.log('info', 'ai_call', { task: request.task, model, mode, ms: Date.now() - started, ok: true });
      return { ok: true, result: { data, model, exchange: { prompt: contents, reply: text } } };
    } catch (thrown) {
      const error = toAiError(thrown, request.signal);
      this.health.recordFailure(model, mode, error);
      this.logger.log('warn', 'ai_call', {
        task: request.task,
        model,
        mode,
        ms: Date.now() - started,
        ok: false,
        kind: error.kind,
        status: error.diagnostics?.status,
        reason: error.diagnostics?.reason,
      });
      return { ok: false, error };
    }
  }
}
