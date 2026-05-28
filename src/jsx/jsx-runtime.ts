/**
 * Automatic JSX runtime shim. Point your bundler at it:
 *
 *   { "jsxImportSource": "@reearth/zushi" }   // tsconfig / esbuild / vite
 *
 * It delegates to the `__zushi_jsx` global installed by the in-VM runtime.
 */
const g = globalThis as any;

/** Fragment sentinel; must match FRAGMENT in ./protocol.ts. */
export const Fragment = "__zushi.Fragment";

export function jsx(type: any, props: any, key?: any): any {
  return g.__zushi_jsx(type, props, key);
}

export const jsxs = jsx;
