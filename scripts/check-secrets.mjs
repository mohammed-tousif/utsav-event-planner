#!/usr/bin/env node
/**
 * Fails if anything that looks like a credential is present in the source
 * tree or the built browser bundle. Run after `npm run build`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'tests', 'scripts', 'dist/client', 'README.md', 'docs', '.env.example', 'render.yaml'];
const SKIP_DIRS = new Set(['node_modules', '.git']);
const PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /gh[pousr]_[0-9A-Za-z]{36,}/ },
  { name: 'Anthropic or OpenAI key', re: /sk-(?:ant-)?[0-9A-Za-z_-]{32,}/ },
];
// The browser bundle must never mention server-only configuration.
const BUNDLE_FORBIDDEN = [/GEMINI_API_KEY/, /process\.env/];

const findings = [];

function walk(target) {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    for (const entry of readdirSync(target)) if (!SKIP_DIRS.has(entry)) walk(path.join(target, entry));
    return;
  }
  if (stats.size > 5_000_000) return;
  const text = readFileSync(target, 'utf8');
  for (const { name, re } of PATTERNS) if (re.test(text)) findings.push(`${target}: possible ${name}`);
  if (target.startsWith(path.join('dist', 'client'))) {
    for (const re of BUNDLE_FORBIDDEN) if (re.test(text)) findings.push(`${target}: browser bundle references ${re.source}`);
  }
}

for (const root of ROOTS) walk(root);

if (findings.length) {
  console.error('Secret scan failed:\n' + findings.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Secret scan passed (${ROOTS.join(', ')}).`);
