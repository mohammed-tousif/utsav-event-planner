import { z } from 'zod';

/** JSON Schema keywords the Gemini structured-output API understands. */
const ALLOWED_KEYS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'description',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'additionalProperties',
  'title',
  'propertyOrdering',
]);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function prune(node: JsonValue): JsonValue {
  if (Array.isArray(node)) return node.map(prune);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, prune(schema)]));
    } else if (ALLOWED_KEYS.has(key)) {
      out[key] = prune(value);
    }
  }
  return out;
}

/**
 * Converts a zod schema (its input side) into the JSON Schema subset sent
 * to Gemini. Unsupported keywords such as `pattern` are removed; the full
 * zod schema still validates the response afterwards.
 */
export function toGeminiSchema(schema: z.ZodType, descriptions: Record<string, string> = {}): Record<string, JsonValue> {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as unknown as JsonValue;
  const pruned = prune(raw) as Record<string, JsonValue>;
  annotate(pruned, descriptions, '');
  return pruned;
}

/** Adds field descriptions by dotted path, e.g. "tasks[].offsetDays". */
function annotate(node: JsonValue, descriptions: Record<string, string>, path: string): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const description = descriptions[path];
  if (description) node.description = description;
  const properties = node.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [name, child] of Object.entries(properties)) annotate(child, descriptions, path ? `${path}.${name}` : name);
  }
  if (node.items) annotate(node.items, descriptions, `${path}[]`);
}

const COMPLEX_KEYS = new Set(['minItems', 'maxItems', 'minimum', 'maximum', 'additionalProperties', 'description', 'title']);

/** A smaller version of a schema without size limits or descriptions, for models that reject the full one. */
export function simplifySchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplifySchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, simplifySchema(schema)]));
    } else if (!COMPLEX_KEYS.has(key)) {
      out[key] = simplifySchema(value);
    }
  }
  return out;
}
