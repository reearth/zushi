import EventTarget from "@ungap/event-target";

import { getFunctionFingerprintString } from "./fingerprint";

export type EventCallback<T extends any[] = any[]> = (...args: T) => void;
export type EventEmitter<
  E extends { [P in string]: any[] } = { [P in string]: any[] }
> = <T extends keyof E>(type: T, ...args: E[T]) => void;

export type Events<
  E extends { [P in string]: any[] } = { [P in string]: any[] }
> = {
  readonly on: <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ) => void;
  readonly off: <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ) => void;
  readonly once: <T extends keyof E>(
    type: T,
    callback: EventCallback<E[T]>
  ) => void;
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

  const deleteEventCallback = (
    type: keyof E,
    cb: EventCallback,
    fingerprint: string
  ): void => {
    const ecbs = callbacks.get(type);
    if (!ecbs) return;
    if (ecbs.has(cb)) {
      ecbs.delete(cb);
    } else {
      const m = soleByFingerprint(ecbs, fingerprint);
      if (m) ecbs.delete(m[0]);
    }
    if (ecbs.size === 0) {
      callbacks.delete(type);
    }
  };

  const on = <T extends keyof E>(type: T, callback: EventCallback<E[T]>) => {
    const fingerprint = getFunctionFingerprintString(callback);
    // Note: when binding callbacks, we don't check fingerprint,
    // because the previous one could be out of lifecycle but with the same fingerprint.
    const ecbFn = getEventCallback(type, callback, fingerprint);
    e.addEventListener(String(type), ecbFn);
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
  const once = <T extends keyof E>(type: T, callback: EventCallback<E[T]>) => {
    const fingerprint = getFunctionFingerprintString(callback);
    const ecbFn = getEventCallback(type, callback, fingerprint);
    const wrapped = (ev: Event): void => {
      // EventTarget auto-removes the listener after it fires, but the `callbacks`
      // Map entry would otherwise leak — drop it here so once-listeners don't
      // accumulate across fires.
      deleteEventCallback(type, ecbFn, fingerprint);
      ecbFn(ev);
    };
    e.addEventListener(String(type), wrapped, { once: true });
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
  const cbs = types.reduce<{ [T in keyof E]: EventCallback<E[T]> }>((a, b) => {
    a[b] = (...args: E[typeof b]) => {
      dest(b, ...args);
    };
    return a;
  }, {} as any);

  for (const t of Object.keys(cbs)) {
    source.on(t, cbs[t]);
  }

  return () => {
    for (const t of Object.keys(cbs)) {
      source.off(t, cbs[t]);
    }
  };
}
