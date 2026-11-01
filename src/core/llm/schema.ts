// Minimal JSON Schema validator covering the keywords used in schemas/.
// Kept small on purpose: no dependency, predictable on every JS engine.

export interface SchemaNode {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  required?: string[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean;
  items?: SchemaNode;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  minItems?: number;
}

export function validate(value: unknown, schema: SchemaNode, path = '$'): string[] {
  const errors: string[] = [];
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: ska vara ett objekt`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: saknas`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...validate(v, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: okänt fält`);
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path}: ska vara en lista`];
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: högst ${schema.maxItems} element`);
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: minst ${schema.minItems} element`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items!, `${path}[${i}]`)));
  } else if (t === 'string') {
    if (typeof value !== 'string') return [`${path}: ska vara text`];
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: för kort`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: för lång`);
  } else if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return [`${path}: ska vara ett tal`];
    if (t === 'integer' && !Number.isInteger(value)) errors.push(`${path}: ska vara ett heltal`);
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: under ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: över ${schema.maximum}`);
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return [`${path}: ska vara sant/falskt`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ogiltigt värde`);
  return errors;
}

/** Pulls a JSON object out of a model answer, tolerating ```json fences and leading prose. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Svaret innehåller ingen JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

const UNSUPPORTED_IN_PROVIDER_SCHEMA = new Set([
  '$schema', '$id', 'minLength', 'maxLength', 'minimum', 'maximum', 'maxItems', 'minItems',
]);

/**
 * Copy of a schema without the keywords that providers' constrained decoding rejects
 * (Anthropic: no string length, numeric or array size limits). Our own validate() still
 * checks the full schema on every answer, so nothing is lost.
 */
export function toProviderSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toProviderSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_IN_PROVIDER_SCHEMA.has(k)) continue;
    out[k] = k === 'properties'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toProviderSchema(pv)]))
      : toProviderSchema(v);
  }
  return out;
}
