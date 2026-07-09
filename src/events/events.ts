import EventTarget from "@ungap/event-target";

import { getFunctionFingerprintString } from "./fingerprint";

export type EventCallback<T extends any[] = any[]> = (...args: T) => void;
export type EventEmitter<
  E extends { [P in string]: any[] } = { [P in string]: any[] }
> = <T extends keyof E>(type: T, ...args: E[T]) => void;

/**
 * Detaches the listener registered by the `on`/`once` call that returned it.
 * Unlike `off(callback)`, it holds the exact registration by identity, so it is
 * immune to the marshaled-callback fingerprint collision — prefer it when the
 * callback may originate from (or cross) the VM boundary.
 */
export type Unsubscribe = () => void;

export type Events<
  E extends { [P in string]: any[] } = { [P in string]: any[] }
> = {
  /**
   * Subscribe to `type`. **Prefer the returned {@link Unsubscribe} handle over
   * {@link off}** to detach: it removes this exact registration by identity,
   * whereas `off(callback)` must fall back to a fingerprint match for callbacks
   * that crossed the VM boundary and can be ambiguous.
   */
  readonly on: <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ) => Unsubscribe;
  /**
   * Detach a listener by callback. Kept for convenience/back-compat; **prefer
   * the {@link Unsubscribe} handle returned by {@link on}/{@link once}**, which
   * is exact. A callback marshaled across the VM boundary arrives as a fresh
   * wrapper each time, so `off` resolves it by source fingerprint — and refuses
   * to act when the fingerprint is ambiguous, leaving the listener attached.
   */
  readonly off: <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ) => void;
  /**
   * Subscribe for a single dispatch. Returns an {@link Unsubscribe} handle that
   * cancels it before it fires; **prefer it over {@link off}** (see {@link on}).
   */
  readonly once: <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ) => Unsubscribe;
};

export function events<
  E extends { [P in string]: any[] } = { [P in string]: any[] }
>(): [Events<E>, EventEmitter<E>] {
  const e = new EventTarget();
  const callbacks = new Map<
    keyof E,
    Map<
      EventCallback<E[keyof E]>,
      { fn: (e: Event) => void; fingerprint: string }
    >
  >();

  // Fallback used when a callback's identity doesn't match a registration — it
  // was re-marshaled across the VM boundary into a different host wrapper
  // between `on` and `off`. Returns the single entry whose fingerprint matches,
  // or undefined when none match OR more than one does: every VM function
  // unmarshals to the same host-wrapper source, so their fingerprints collide,
  // and guessing which to drop could detach the wrong listener — remove none.
  const soleByFingerprint = (
    ecbs: Map<
      EventCallback<E[keyof E]>,
      { fn: (e: Event) => void; fingerprint: string }
    >,
    fingerprint: string
  ): [EventCallback<E[keyof E]>, { fn: (e: Event) => void; fingerprint: string }] | undefined => {
    let match:
      | [EventCallback<E[keyof E]>, { fn: (e: Event) => void; fingerprint: string }]
      | undefined;
    let count = 0;
    for (const entry of ecbs.entries()) {
      if (entry[1].fingerprint === fingerprint) {
        if (++count > 1) return undefined; // ambiguous
        match = entry;
      }
    }
    return match;
  };

  const getEventCallback = <T extends keyof E>(
    type: T,
    cb: EventCallback<E[T]>,
    fingerprint: string
  ): ((e: Event) => void) => {
    let ecbs = callbacks.get(type);
    if (!ecbs) {
      ecbs = new Map();
      callbacks.set(type, ecbs);
    }

    let ecb = ecbs.get(cb as EventCallback);
    if (!ecb) {
      ecb = {
        fn: (e: Event): void => {
          cb(...(e as CustomEvent).detail);
        },
        fingerprint
      };
      ecbs.set(cb as EventCallback, ecb);
    }

    return ecb.fn;
  };

  const on = <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ): Unsubscribe => {
    const fingerprint = getFunctionFingerprintString(callback);
    // Note: when binding callbacks, we don't check fingerprint,
    // because the previous one could be out of lifecycle but with the same fingerprint.
    const ecbFn = getEventCallback(type, callback, fingerprint);
    e.addEventListener(String(type), ecbFn);
    const key = callback as EventCallback<E[keyof E]>;
    // Removes this exact registration by identity — no fingerprint, no
    // ambiguity, even if the callback was marshaled across the VM boundary.
    return () => {
      e.removeEventListener(String(type), ecbFn);
      const ecbs = callbacks.get(type);
      if (ecbs) {
        ecbs.delete(key);
        if (ecbs.size === 0) callbacks.delete(type);
      }
    };
  };
  const off = <T extends keyof E>(type: T, callback: EventCallback<E[T]>) => {
    const ecbs = callbacks.get(type);
    if (!ecbs) return;
    const fingerprint = getFunctionFingerprintString(callback);
    let key = callback as EventCallback<E[keyof E]>;
    let ecb = ecbs.get(key);
    if (!ecb) {
      // Identity miss: the callback was re-marshaled into a different host
      // wrapper between `on` and `off`. Resolve by fingerprint, but only when it
      // is unambiguous — never guess and detach the wrong listener.
      const m = soleByFingerprint(ecbs, fingerprint);
      if (!m) return;
      [key, ecb] = m;
    }
    e.removeEventListener(String(type), ecb.fn);
    ecbs.delete(key);
    if (ecbs.size === 0) callbacks.delete(type);
  };
  const once = <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ): Unsubscribe => {
    const fingerprint = getFunctionFingerprintString(callback);
    const ecbFn = getEventCallback(type, callback, fingerprint);
    const key = callback as EventCallback<E[keyof E]>;
    // Drop the `callbacks` Map entry by identity (EventTarget removes the
    // listener itself via `{ once: true }` / removeEventListener). Doing it by
    // identity avoids relying on the collision-prone fingerprint fallback.
    const removeEntry = (): void => {
      const ecbs = callbacks.get(type);
      if (ecbs) {
        ecbs.delete(key);
        if (ecbs.size === 0) callbacks.delete(type);
      }
    };
    const wrapped = (ev: Event): void => {
      removeEntry();
      ecbFn(ev);
    };
    e.addEventListener(String(type), wrapped, { once: true });
    // Cancel before it fires: detach the listener and drop the entry.
    return () => {
      e.removeEventListener(String(type), wrapped);
      removeEntry();
    };
  };

  const events = {
    get on() {
      return on;
    },
    get off() {
      return off;
    },
    get once() {
      return once;
    }
  };

  return [
    events,
    <T extends keyof E>(type: T, ...args: E[T]) =>
      e.dispatchEvent(new CustomEvent(String(type), { detail: args }))
  ];
}

export function mergeEvents<
  E extends Record<string, any[]> = Record<string, any[]>
>(source: Events<E>, dest: EventEmitter<E>, types: (keyof E)[]): () => void {
  // Forward each type and keep the unsubscribe handle, so teardown detaches the
  // exact registrations by identity — no fingerprint round-trip.
  const unsubs = types.map((t) =>
    source.on(t, (...args: E[typeof t]) => {
      dest(t, ...args);
    })
  );
  return () => {
    for (const unsub of unsubs) unsub();
  };
}
