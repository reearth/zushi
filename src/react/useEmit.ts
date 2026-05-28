import { useEffect, useRef } from "react";

/**
 * Emits values onto an event emitter whenever a value's identity changes.
 * Useful for pushing host state changes into the plugin as events.
 */
export function useEmit<T extends { [K in string]: any[] }>(
  values: { [K in keyof T]?: T[K] | undefined },
  emit: (<K extends keyof T>(key: K, ...args: T[K]) => void) | undefined
): void {
  const prev = useRef<{ [K in keyof T]?: T[K] | undefined }>({});

  useEffect(() => {
    for (const k of Object.keys(values) as (keyof T)[]) {
      const args = values[k];
      if (args && args !== prev.current[k]) {
        emit?.(k, ...args);
      }
      prev.current[k] = args;
    }
  });
}
