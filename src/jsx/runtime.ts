/**
 * Explicit-import surface for plugin authors who bundle their plugin code:
 *
 *   import { render, useState, createElement, Fragment } from "@reearth/zushi/jsx";
 *
 * Every export delegates to the runtime bundle the in-VM runtime installs at the
 * placement-independent global `__zushi_api` (see ./vmRuntime), so bundled code
 * links up at VM execution time regardless of where the host placed the API for
 * raw-source plugins (the `namespace` option / `runtime` refs). `registerComponent`
 * is part of the bundle only when the host opts in (`exposeRegisterComponent`).
 */
type Props = Record<string, any> & { key?: unknown; children?: unknown };
type Component = (props: any) => unknown;
export type VNode = {
  type: string | Component | string;
  props: Props;
  children: unknown[];
  key?: unknown;
};

const g = globalThis as any;

/** The placement-independent runtime bundle installed by the in-VM runtime. */
const api = (): any => g.__zushi_api || {};

/** Fragment sentinel; must match FRAGMENT in ./protocol.ts. */
export const Fragment = "__zushi.Fragment";

export function createElement(
  type: string | Component,
  props?: Props | null,
  ...children: unknown[]
): VNode {
  return api().createElement(type, props, ...children);
}

export const h = createElement;

/** Render an element tree into a plugin UI surface (defaults to the main UI). */
export function render(
  element: unknown,
  options?: {
    surface?: string;
    visible?: boolean;
    width?: number | string;
    height?: number | string;
  }
): void {
  api().render(element, options);
}

/**
 * Register a trusted custom component, also made available as a global of the
 * same name. Typically called from the host's trusted `setup` source, not
 * from plugin code (it is absent from the bundle unless the host opts in).
 */
export function registerComponent(name: string, fn: Component): void {
  api().registerComponent(name, fn);
}

export function useState<S>(
  initial: S | (() => S)
): [S, (next: S | ((prev: S) => S)) => void] {
  return api().useState(initial);
}

export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialArg: S,
  init?: (arg: S) => S
): [S, (action: A) => void] {
  return api().useReducer(reducer, initialArg, init);
}

export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  api().useEffect(effect, deps);
}

/** Alias for {@link useEffect}; there is no separate layout phase in the VM. */
export function useLayoutEffect(
  effect: () => void | (() => void),
  deps?: unknown[]
): void {
  api().useLayoutEffect(effect, deps);
}

export function useMemo<T>(factory: () => T, deps?: unknown[]): T {
  return api().useMemo(factory, deps);
}

export function useCallback<T extends (...args: any[]) => any>(cb: T, deps?: unknown[]): T {
  return api().useCallback(cb, deps);
}

export function useRef<T>(initial: T): { current: T } {
  return api().useRef(initial);
}

/** Returns a stable id for the calling component, e.g. for form/aria wiring. */
export function useId(): string {
  return api().useId();
}

export type Context<T> = {
  Provider: (props: { value: T; children?: unknown }) => unknown;
};

export function createContext<T>(defaultValue: T): Context<T> {
  return api().createContext(defaultValue);
}

export function useContext<T>(context: Context<T>): T {
  return api().useContext(context);
}

/** Memoize a component: re-uses its last render when props are shallow-equal. */
export function memo<P>(
  component: (props: P) => unknown,
  areEqual?: (prev: P, next: P) => boolean
): (props: P) => unknown {
  return api().memo(component, areEqual);
}

/**
 * Catches errors thrown while rendering its children and shows `fallback`
 * (a node or `(error) => node`) instead. Used by identity as a component type,
 * so this is the real marked runtime function (captured at module load, which
 * for bundled plugins runs after the runtime is installed).
 */
export const ErrorBoundary: (props: {
  fallback: unknown | ((error: unknown) => unknown);
  onError?: (error: unknown) => void;
  children?: unknown;
}) => unknown = api().ErrorBoundary;

/**
 * Shows `fallback` while a child throws a thenable, then re-renders when it
 * settles. (No `lazy()` — the VM has no module loader.)
 */
export const Suspense: (props: {
  fallback: unknown;
  children?: unknown;
}) => unknown = api().Suspense;
