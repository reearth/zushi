/**
 * Automatic JSX dev runtime shim (used when the bundler is in development
 * mode). Delegates to the `__zushi_jsx` global installed by the in-VM runtime.
 */
const g = globalThis as any;

/** Fragment sentinel; must match FRAGMENT in ./protocol.ts. */
export const Fragment = "__zushi.Fragment";

export function jsxDEV(type: any, props: any, key?: any): any {
  return g.__zushi_jsx(type, props, key);
}
