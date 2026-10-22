export type ProviderName = 'gemini' | 'sample';

export interface ServerConfig {
  port: number;
  isProduction: boolean;
  provider: ProviderName;
  gemini: {
    apiKey: string;
    model: string;
    /** Tried in order when the primary model is rate-limited, unavailable or returns bad output. */
    fallbackModels: string[];
    timeoutMs: number;
    thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'OFF';
  };
  rateLimit: { windowMs: number; maxAiRequests: number };
  trustProxy: number;
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const THINKING_LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'OFF'] as const;

/**
 * Reads configuration from the environment. The API key is only ever held
 * here and in the Gemini provider; it is never sent to the browser or logged.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProduction = env.NODE_ENV === 'production';
  const apiKey = (env.GEMINI_API_KEY ?? '').trim();
  const requested = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  // Sample data is only used when explicitly requested, or in development
  // without a key. Production without a key reports AI as unavailable.
  const provider: ProviderName =
    requested === 'sample' || (!isProduction && !apiKey && requested !== 'gemini') ? 'sample' : 'gemini';
  const level = (env.GEMINI_THINKING_LEVEL ?? 'LOW').toUpperCase();
  return {
    port: int(env.PORT, 8080, 1, 65535),
    isProduction,
    provider,
    gemini: {
      apiKey,
      model: (env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite').trim(),
      fallbackModels: (env.GEMINI_FALLBACK_MODELS ?? env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.6-flash,gemini-3.8-flash')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
        .slice(0, 3),
      timeoutMs: int(env.GEMINI_TIMEOUT_MS, 40_000, 5_000, 120_000),
      thinkingLevel: (THINKING_LEVELS as readonly string[]).includes(level)
        ? (level as ServerConfig['gemini']['thinkingLevel'])
        : 'LOW',
    },
    rateLimit: {
      windowMs: int(env.RATE_LIMIT_WINDOW_MS, 15 * 60_000, 1_000, 24 * 3_600_000),
      maxAiRequests: int(env.RATE_LIMIT_MAX_AI, 12, 1, 1_000),
    },
    trustProxy: int(env.TRUST_PROXY, isProduction ? 1 : 0, 0, 5),
  };
}
