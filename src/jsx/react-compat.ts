/**
 * **Experimental** React-compatibility shim for plugin bundles.
 *
 * Alias your bundler's `"react"` to `"@reearth/zushi/react-compat"` (and set
 * `jsxImportSource` to `"@reearth/zushi"`) and *headless* React libraries that
 * only use hooks + elements may run inside the VM against zushi's runtime.
 *
 * This is best-effort: anything touching `react-dom`, real DOM refs, portals,
 * concurrent features, or `react`'s own context identity will not work. It maps
 * a subset of the React API onto the globals installed by ./vmRuntime.
 */
const g = globalThis as any;

export const createElement = (...args: any[]) => g.createElement(...args);
export const Fragment = "__zushi.Fragment";

export const useState = (initial: any) => g.useState(initial);
export const useReducer = (r: any, i: any, init?: any) => g.useReducer(r, i, init);
export const useEffect = (fn: any, deps?: any) => g.useEffect(fn, deps);
export const useLayoutEffect = (fn: any, deps?: any) => g.useLayoutEffect(fn, deps);
export const useMemo = (fn: any, deps?: any) => g.useMemo(fn, deps);
export const useCallback = (fn: any, deps?: any) => g.useCallback(fn, deps);
export const useRef = (initial: any) => g.useRef(initial);
export const useId = () => g.useId();
export const createContext = (dflt: any) => g.createContext(dflt);
export const useContext = (ctx: any) => g.useContext(ctx);
export const memo = (fn: any, areEqual?: any) => g.memo(fn, areEqual);

export const Suspense = (props: any) => g.Suspense(props);

const toArray = (c: any): any[] => (c == null ? [] : Array.isArray(c) ? c : [c]);

export const Children = {
  map: (c: any, fn: any) => toArray(c).map(fn),
  forEach: (c: any, fn: any) => toArray(c).forEach(fn),
  toArray: (c: any) => toArray(c).slice(),
  count: (c: any) => toArray(c).length,
  only: (c: any) => toArray(c)[0]
};

export function isValidElement(v: any): boolean {
  return !!v && typeof v === "object" && "type" in v && "props" in v;
}

export function createRef<T = unknown>(): { current: T | null } {
  return { current: null };
}

/** Best-effort: passes the `ref` prop through as the second argument. */
export function forwardRef<P>(render: (props: P, ref: any) => unknown) {
  return (props: any) => render(props, props ? props.ref : undefined);
}

export default {
  createElement,
  Fragment,
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  useId,
  createContext,
  useContext,
  memo,
  Suspense,
  Children,
  isValidElement,
  createRef,
  forwardRef
};
