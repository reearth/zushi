import { ClientStorage } from "../storage";

export type SyncedStoreOptions = {
  /** Values to seed the store with (before any persisted values are loaded). */
  initial?: Record<string, unknown>;
  /** Persist values across reloads via {@link storage} (IndexedDB). */
  persist?: boolean;
  /** Backing store for persistence; a default `ClientStorage` is used if omitted. */
  storage?: ClientStorage;
  /** Namespaces persisted keys (default `"default"`). */
  instanceId?: string;
  /** Called on every change (host or plugin), e.g. for logging. */
  onChange?: (key: string, value: unknown) => void;
};

type KeyListener = () => void;
type AllListener = (key: string, value: unknown) => void;

/**
 * A host-owned key-value store shared between the host and the plugin VM,
 * backing the `useSyncedState` / `useSyncedMap` hooks. It lives outside the VM
 * (so it survives dispose and is shared across surfaces), the host can read,
 * write, and subscribe to it (`plugin.synced`), and it can optionally persist
 * to IndexedDB so state survives reloads.
 *
 * Values must be plain data (they cross the VM boundary and may be persisted) —
 * functions and class instances won't round-trip.
 */
export class SyncedStore {
  private map = new Map<string, unknown>();
  private keyListeners = new Map<string, Set<KeyListener>>();
  private allListeners = new Set<AllListener>();
  private persist: boolean;
  private storage: ClientStorage | undefined;
  private instanceId: string;
  private onChange: ((key: string, value: unknown) => void) | undefined;

  constructor(opts: SyncedStoreOptions = {}) {
    this.persist = !!opts.persist;
    this.instanceId = opts.instanceId ?? "default";
    this.onChange = opts.onChange;
    if (this.persist) this.storage = opts.storage ?? new ClientStorage();
    if (opts.initial) {
      for (const k of Object.keys(opts.initial)) this.map.set(k, opts.initial[k]);
    }
  }

  /**
   * Load persisted values into memory. Awaited by `Plugin.start()` before the
   * plugin runs, so synced reads are correct on first render. No-op unless
   * persistence is enabled.
   */
  async hydrate(): Promise<void> {
    if (!this.persist || !this.storage) return;
    const keys = await this.storage.keysAsync(this.instanceId);
    for (const key of keys) {
      this.map.set(key, await this.storage.getAsync(this.instanceId, key));
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): unknown {
    return this.map.get(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  entries(): [string, unknown][] {
    return [...this.map.entries()];
  }

  set(key: string, value: unknown): void {
    if (this.map.has(key) && Object.is(this.map.get(key), value)) return;
    this.map.set(key, value);
    if (this.persist && this.storage) {
      void this.storage.setAsync(this.instanceId, key, value);
    }
    this.notify(key, value);
  }

  delete(key: string): void {
    if (!this.map.has(key)) return;
    this.map.delete(key);
    if (this.persist && this.storage) {
      void this.storage.deleteAsync(this.instanceId, key);
    }
    this.notify(key, undefined);
  }

  /** Host-facing: subscribe to every change. Returns an unsubscribe function. */
  subscribe(cb: AllListener): () => void {
    this.allListeners.add(cb);
    return () => this.allListeners.delete(cb);
  }

  /** VM-facing: subscribe to one key. Returns an unsubscribe function. */
  subscribeKey(key: string, cb: KeyListener): () => void {
    let set = this.keyListeners.get(key);
    if (!set) {
      set = new Set();
      this.keyListeners.set(key, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }

  private notify(key: string, value: unknown): void {
    this.keyListeners.get(key)?.forEach((cb) => cb());
    this.allListeners.forEach((cb) => cb(key, value));
    this.onChange?.(key, value);
  }
}
