type Level = 'info' | 'warn' | 'error';

/**
 * Minimal structured logger. Callers pass only operational fields (route,
 * status, latency, model) — never request bodies, plans or credentials.
 */
export interface Logger {
  log(level: Level, event: string, fields?: Record<string, string | number | boolean | undefined>): void;
}

export const consoleLogger: Logger = {
  log(level, event, fields = {}) {
    const line = JSON.stringify({ time: new Date().toISOString(), severity: level.toUpperCase(), event, ...fields });
    if (level === 'error') console.error(line);
    else console.log(line);
  },
};

export const silentLogger: Logger = { log() {} };
