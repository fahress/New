/**
 * A small JSON Schema subset, used for tool inputs (sent to the model and checked on the server
 * with the same definition) and for the agent settings. Supports: type, properties, required,
 * additionalProperties:false, enum, const, minimum/maximum, minLength/maxLength, pattern,
 * items, minItems/maxItems, uniqueItems, anyOf, description, default.
 */
export type Schema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | ('string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array')[];
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number | boolean | null)[];
  const?: string | number | boolean | null;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'uri' | 'uuid';
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  anyOf?: Schema[];
  default?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Returns a list of problems (empty when valid). Paths are like `changes[2].field`. */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errs: string[] = [];
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validate(s, value, path).length === 0);
    if (!ok) errs.push(`${path}: doesn’t match any allowed shape`);
    return errs;
  }
  if (schema.const !== undefined && value !== schema.const) return [`${path}: must be ${JSON.stringify(schema.const)}`];
  if (schema.enum && !schema.enum.includes(value as never)) return [`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    const ok = types.some((x) => x === t || (x === 'integer' && t === 'number' && Number.isInteger(value)) || (x === 'number' && t === 'number' && Number.isFinite(value as number)));
    if (!ok) return [`${path}: expected ${types.join(' or ')}, got ${t}`];
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path}: at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: has the wrong format`);
    if (schema.format === 'uuid' && !UUID.test(value)) errs.push(`${path}: must be a record id`);
    if (schema.format === 'uri' && !/^https?:\/\/[^\s<>"]+$/i.test(value)) errs.push(`${path}: must be a web address (https://…)`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: must be ≤ ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${path}: items must be unique`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items!, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in obj) || obj[r] === undefined) errs.push(`${path}.${r}: is required`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validate(sub, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: is not allowed`);
    }
  }
  return errs.slice(0, 20);
}

/** Schema without our extras, in the shape model providers accept for tool parameters. */
export function toJsonSchema(s: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v as Record<string, Schema>).map(([pk, pv]) => [pk, toJsonSchema(pv)]));
    else if (k === 'items') out[k] = toJsonSchema(v as Schema);
    else if (k === 'anyOf') out[k] = (v as Schema[]).map(toJsonSchema);
    else if (k === 'format' && v === 'uuid') continue;
    else out[k] = v;
  }
  return out;
}
