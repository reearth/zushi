function isPlainObject(v: any): v is Record<string, any> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Shallow-recursive merge of plain objects. `override` wins; nested plain
 * objects are merged, everything else (functions, arrays, primitives) is
 * replaced. Inputs are not mutated.
 */
export function merge(
  base: Record<string, any>,
  override?: Record<string, any>
): Record<string, any> {
  if (!override) return { ...base };
  const out: Record<string, any> = { ...base };
  for (const key of Object.keys(override)) {
    // Skip keys that could alter the result's prototype chain, so a
    // plugin-derived override can't pollute Object.prototype.
    if (key === "__proto__" || key === "constructor" || key === "prototype")
      continue;
    const a = out[key];
    const b = override[key];
    out[key] = isPlainObject(a) && isPlainObject(b) ? merge(a, b) : b;
  }
  return out;
}
