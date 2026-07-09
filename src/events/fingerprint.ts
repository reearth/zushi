/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/**
 * Generates a fingerprint for a function that stays stable even after the
 * function is marshaled/unmarshaled through QuickJS.
 *
 * Why this exists: a plugin function passed to `on(cb)` and later `off(cb)` may
 * arrive as two *different* host wrapper objects (quickjs-emscripten-sync can
 * mint a fresh wrapper per crossing), so identity (`===`) alone can't match the
 * two. The fingerprint — derived from the function's source text — lets `off`
 * find the registration made by `on`.
 *
 * ⚠️ Collision caveat: every VM function unmarshals to the *same* host wrapper
 * source, so all marshaled callbacks share one fingerprint. Callers must treat
 * the fingerprint as a best-effort identity hint and fall back safely when it
 * is ambiguous — see `events.ts`, which prefers identity and only uses the
 * fingerprint when exactly one registration matches.
 */

export interface FunctionFingerprint {
  name: string;
  source: string;
  length: number;
  hash: string;
}

/**
 * Simple hash function for strings (djb2 algorithm)
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36); // Convert to base36 for shorter string
}

/**
 * Generate a fingerprint object for a function
 */
export function getFunctionFingerprint(fn: Function): FunctionFingerprint {
  const name = fn.name || "";
  const source = fn.toString();
  const length = fn.length;

  // Create a composite hash from all properties
  const composite = `${name}|${source}|${length}`;
  const hash = hashString(composite);

  return {
    name,
    source,
    length,
    hash
  };
}

/**
 * Generate a simple string fingerprint for a function
 * This is the most convenient form for use as a Map key
 */
export function getFunctionFingerprintString(fn: Function): string {
  const fingerprint = getFunctionFingerprint(fn);
  return fingerprint.hash;
}

/**
 * Compare two functions by their fingerprints
 */
export function areFunctionsSame(fn1: Function, fn2: Function): boolean {
  const fp1 = getFunctionFingerprint(fn1);
  const fp2 = getFunctionFingerprint(fn2);

  return fp1.hash === fp2.hash;
}
