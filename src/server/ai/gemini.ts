import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from '@google/genai';
import type { z } from 'zod';
import { AiPlanDraftSchema, AiRevisionSchema, type EventInput, type Plan } from '../../shared/schemas';
import type { ServerConfig } from '../config';
import type { Logger } from '../logger';
import { toGeminiSchema } from './jsonSchema';
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

/** Content that every model reply must pass before the app uses it. */
type Schema<T> = z.ZodType<T>;

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
  private readonly planSchema = toGeminiSchema(AiPlanDraftSchema, PLAN_DESCRIPTIONS);
  private readonly revisionSchema = toGeminiSchema(AiRevisionSchema, REVISION_DESCRIPTIONS);

  constructor(
    private readonly config: ServerConfig['gemini'],
    private readonly logger: Logger,
    private readonly client: GeminiClient | null = config.apiKey ? createGoogleClient(config.apiKey) : null,
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
   * One structured call with a bounded recovery path: a malformed reply is
   * retried once; a quota or availability error on the primary model falls
   * back once to the lighter model. Nothing else is retried.
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
    const models = [this.config.model, this.config.fallbackModel].filter((m, i, all) => m && all.indexOf(m) === i);
    let lastError: AiError | undefined;

    for (const [modelIndex, model] of models.entries()) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const started = Date.now();
        try {
          const data = await this.once(model, systemInstruction, prompt, jsonSchema, schema, signal, temperature);
          this.logger.log('info', 'ai_call', { task, model, attempt, ms: Date.now() - started, ok: true });
          return { data, model };
        } catch (error) {
          const mapped = this.mapError(error, signal);
          this.logger.log('warn', 'ai_call', { task, model, attempt, ms: Date.now() - started, ok: false, kind: mapped.kind });
          lastError = mapped;
          if (mapped.kind === 'invalid_output' && attempt === 0) continue; // retry the same model once
          break;
        }
      }
      const canFallBack = lastError && ['rate_limited', 'unavailable', 'invalid_output'].includes(lastError.kind);
      if (!canFallBack || modelIndex === models.length - 1) break;
    }
    throw lastError ?? new AiError('unavailable', 'The AI planner did not respond.');
  }

  private async once<T>(
    model: string,
    systemInstruction: string,
    prompt: string,
    jsonSchema: unknown,
    schema: Schema<T>,
    signal: AbortSignal | undefined,
    temperature: number,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const result = await this.client!.generate(model, prompt, {
      systemInstruction,
      temperature,
      maxOutputTokens: 12_000,
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      thinkingConfig: mapThinking(this.config.thinkingLevel),
      abortSignal: combined,
      httpOptions: { timeout: this.config.timeoutMs },
    });
    if (result.blockReason) throw new AiError('blocked', 'The AI declined this request. Rephrase it and try again.');
    if (!result.text) {
      throw new AiError(
        'invalid_output',
        result.finishReason === 'MAX_TOKENS' ? 'The AI reply was cut off.' : 'The AI returned an empty reply.',
      );
    }
    let json: unknown;
    try {
      json = parseJson(result.text);
    } catch {
      throw new AiError('invalid_output', 'The AI reply was not valid JSON.');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AiError('invalid_output', 'The AI reply did not match the expected plan structure.');
    return parsed.data;
  }

  private mapError(error: unknown, signal: AbortSignal | undefined): AiError {
    if (error instanceof AiError) return error;
    if (signal?.aborted) return new AiError('timeout', 'The request was cancelled.');
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /timed? ?out|aborted/i.test(error.message))) {
      return new AiError('timeout', 'The AI took too long to answer. Try again.');
    }
    if (error instanceof ApiError) {
      if (error.status === 429) return new AiError('rate_limited', 'The AI is busy or the free quota is used up. Wait a minute and try again.', 60);
      if (error.status === 400 && /api key/i.test(error.message)) return new AiError('not_configured', 'The AI key on the server is not valid.');
      if (error.status === 401 || error.status === 403) return new AiError('not_configured', 'The AI key on the server is not valid.');
      if (error.status === 404) return new AiError('unavailable', 'The configured AI model is not available.');
      if (error.status >= 500) return new AiError('unavailable', 'The AI service is having problems. Try again shortly.');
      return new AiError('invalid_output', 'The AI could not process this request.');
    }
    return new AiError('unavailable', 'Could not reach the AI service.');
  }
}
