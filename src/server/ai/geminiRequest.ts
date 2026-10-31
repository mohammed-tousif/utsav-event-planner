import { ThinkingLevel, type GenerateContentConfig } from '@google/genai';
import type { z } from 'zod';
import type { ServerConfig } from '../config';
import { simplifySchema } from './jsonSchema';
import type { CallMode } from './modelHealth';
import { normalizeModelJson } from './normalize';
import { AiError } from './types';

const MAX_OUTPUT_TOKENS = 16_000;

/** Everything needed to ask Gemini for one structured reply. */
export interface StructuredRequest<T> {
  task: 'plan' | 'revise';
  systemInstruction: string;
  prompt: string;
  /** JSON Schema sent to the API (or embedded in the prompt in plain JSON mode). */
  jsonSchema: unknown;
  /** The zod schema every reply must pass before the app uses it. */
  schema: z.ZodType<T>;
  temperature: number;
  signal?: AbortSignal;
}

export interface ModelReply {
  text: string | undefined;
  blockReason?: string;
  finishReason?: string;
}

type Settings = Pick<ServerConfig['gemini'], 'timeoutMs' | 'thinkingLevel'>;

function thinkingConfig(level: Settings['thinkingLevel']): GenerateContentConfig['thinkingConfig'] {
  return level === 'OFF' ? undefined : { thinkingLevel: ThinkingLevel[level] };
}

/** The prompt actually sent: plain JSON mode carries the schema in the text. */
export function contentsFor(mode: CallMode, request: StructuredRequest<unknown>): string {
  if (mode !== 'json') return request.prompt;
  return `${request.prompt}\n\nReturn only a JSON object that matches this JSON Schema exactly:\n${JSON.stringify(request.jsonSchema)}`;
}

export function configFor(mode: CallMode, request: StructuredRequest<unknown>, settings: Settings): GenerateContentConfig {
  const timeout = AbortSignal.timeout(settings.timeoutMs);
  const shared: GenerateContentConfig = {
    systemInstruction: request.systemInstruction,
    temperature: request.temperature,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    abortSignal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout,
    httpOptions: { timeout: settings.timeoutMs },
  };
  if (mode === 'schema')
    return { ...shared, responseJsonSchema: request.jsonSchema, thinkingConfig: thinkingConfig(settings.thinkingLevel) };
  if (mode === 'schema-simple') return { ...shared, responseJsonSchema: simplifySchema(request.jsonSchema) };
  return shared;
}

function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '');
  return JSON.parse(trimmed);
}

/** Checks a raw reply and returns validated data, or throws an AiError explaining what was wrong. */
export function readReply<T>(reply: ModelReply, schema: z.ZodType<T>): { data: T; text: string } {
  if (reply.blockReason) throw new AiError('blocked', 'The AI declined this request. Rephrase it and try again.');
  if (!reply.text) {
    const cutOff = reply.finishReason === 'MAX_TOKENS';
    throw new AiError('invalid_output', cutOff ? 'The AI reply was cut off.' : 'The AI returned an empty reply.', undefined, {
      reason: `empty reply, finishReason=${reply.finishReason ?? 'none'}`,
    });
  }
  let json: unknown;
  try {
    json = parseJson(reply.text);
  } catch {
    throw new AiError('invalid_output', 'The AI reply was not valid JSON.', undefined, {
      reason: `unparseable JSON (${reply.text.length} chars)`,
    });
  }
  const parsed = schema.safeParse(normalizeModelJson(json));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AiError('invalid_output', 'The AI reply did not match the expected plan structure.', undefined, {
      reason: `schema mismatch at ${first?.path.join('.') || 'root'}: ${first?.message ?? ''}`.slice(0, 200),
    });
  }
  return { data: parsed.data, text: reply.text };
}
