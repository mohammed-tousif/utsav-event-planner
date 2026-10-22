import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiProvider } from './ai/gemini';
import { SampleProvider } from './ai/sample';
import type { AiProvider } from './ai/types';
import { createApp } from './app';
import { loadConfig } from './config';
import { consoleLogger } from './logger';

const config = loadConfig();
const provider: AiProvider = config.provider === 'sample' ? new SampleProvider() : new GeminiProvider(config.gemini, consoleLogger);

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, '../client');

const app = createApp({ config, provider, logger: consoleLogger, staticDir });

const server = app.listen(config.port, () => {
  consoleLogger.log('info', 'server_started', {
    port: config.port,
    provider: provider.name,
    model: provider.model,
    aiConfigured: provider.configured,
  });
});

function shutdown(signal: string) {
  consoleLogger.log('info', 'server_stopping', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
