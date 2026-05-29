/**
 * Explicit-import surface for plugin authors who bundle their plugin code:
 *
 *   import { render, useState, createElement, Fragment } from "@reearth/zushi/jsx";
 *
 * Every export simply delegates to the globals installed by the in-VM runtime
 * (see ./vmRuntime), so the bundled code links up at VM execution time. For
 * plugins evaluated as a raw source string, the same names are available as
 * bare globals and this import is optional.
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

/** Fragment sentinel; must match FRAGMENT in ./protocol.ts. */
export const Fragment = "__zushi.Fragment";

export function createElement(
  type: string | Component,
  props?: Props | null,
  ...children: unknown[]
): VNode {
  return g.createElement(type, props, ...children);
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
  g.render(element, options);
}

/**
 * Register a trusted custom component, also made available as a global of the
 * same name. Typically called from the host's trusted `setup` source, not
 * from plugin code.
 */
export function registerComponent(name: string, fn: Component): void {
  g.registerComponent(name, fn);
}

export function useState<S>(
  initial: S | (() => S)
): [S, (next: S | ((prev: S) => S)) => void] {
  return g.useState(initial);
}

export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialArg: S,
  init?: (arg: S) => S
): [S, (action: A) => void] {
  return g.useReducer(reducer, initialArg, init);
}

export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  g.useEffect(effect, deps);
}

/** Alias for {@link useEffect}; there is no separate layout phase in the VM. */
export function useLayoutEffect(
  effect: () => void | (() => void),
  deps?: unknown[]
): void {
  g.useLayoutEffect(effect, deps);
}

export function useMemo<T>(factory: () => T, deps?: unknown[]): T {
  return g.useMemo(factory, deps);
}

export function useCallback<T extends (...args: any[]) => any>(cb: T, deps?: unknown[]): T {
  return g.useCallback(cb, deps);
}

export function useRef<T>(initial: T): { current: T } {
  return g.useRef(initial);
}

/** Returns a stable id for the calling component, e.g. for form/aria wiring. */
export function useId(): string {
  return g.useId();
}

export type Context<T> = {
  Provider: (props: { value: T; children?: unknown }) => unknown;
};

export function createContext<T>(defaultValue: T): Context<T> {
  return g.createContext(defaultValue);
}

export function useContext<T>(context: Context<T>): T {
  return g.useContext(context);
}

/** Memoize a component: re-uses its last render when props are shallow-equal. */
export function memo<P>(
  component: (props: P) => unknown,
  areEqual?: (prev: P, next: P) => boolean
): (props: P) => unknown {
  return g.memo(component, areEqual);
}

/**
 * Catches errors thrown while rendering its children and shows `fallback`
 * (a node or `(error) => node`) instead.
 */
export const ErrorBoundary: (props: {
  fallback: unknown | ((error: unknown) => unknown);
  onError?: (error: unknown) => void;
  children?: unknown;
}) => unknown = (g as any).ErrorBoundary;

/**
 * Shows `fallback` while a child throws a thenable, then re-renders when it
 * settles. (No `lazy()` — the VM has no module loader.)
 */
export const Suspense: (props: {
  fallback: unknown;
  children?: unknown;
}) => unknown = (g as any).Suspense;
