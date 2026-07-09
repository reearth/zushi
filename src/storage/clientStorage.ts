// `LocalForage` is an ambient global type from localforage's typings, so no
// value import is needed here. Load the runtime lazily (dynamic import) so
// merely importing zushi doesn't pull ~29KB of localforage until a store is
// actually used; the module promise is cached after the first access.
let localforagePromise: Promise<LocalForage> | undefined;
const getLocalforage = (): Promise<LocalForage> =>
  (localforagePromise ??= import("localforage").then((m) => m.default));

export type ClientStorageAPI = {
  getAsync: (instanceId: string, key: string) => Promise<any>;
  setAsync: (instanceId: string, key: string, value: any) => Promise<void>;
  deleteAsync: (instanceId: string, key: string) => Promise<void>;
  keysAsync: (instanceId: string) => Promise<string[]>;
  dropStore: (instanceId: string) => Promise<void>;
};

/**
 * A view of {@link ClientStorage} bound to one plugin instance. Its methods
 * take no `instanceId`, so plugin code handed this facade cannot address
 * another instance's store. Obtain it from {@link ClientStorage.scoped}.
 */
export type ScopedClientStorage = {
  getAsync: (key: string) => Promise<any>;
  setAsync: (key: string, value: any) => Promise<void>;
  deleteAsync: (key: string) => Promise<void>;
  keysAsync: () => Promise<string[]>;
  dropStore: () => Promise<void>;
};

export type ClientStorageOptions = {
  /**
   * Resolves a localforage store name from a plugin instance id.
   * Defaults to `zushi-plugin-${instanceId}`.
   */
  storeName?: (instanceId: string) => string;
};

const defaultStoreName = (instanceId: string) => `zushi-plugin-${instanceId}`;

/**
 * Per-instance key-value storage backed by IndexedDB (via localforage).
 * Each plugin instance gets an isolated store.
 *
 * ⚠️ The {@link ClientStorageAPI} methods take an `instanceId` argument, so a
 * plugin given this object directly could pass any id and read or write another
 * instance's (or the host's) store. Do **not** expose a `ClientStorage` into a
 * plugin VM — expose {@link scoped}(instanceId) instead, which binds the id.
 */
export class ClientStorage implements ClientStorageAPI {
  private stores = new Map<string, LocalForage>();
  private resolveStoreName: (instanceId: string) => string;

  constructor(options: ClientStorageOptions = {}) {
    this.resolveStoreName = options.storeName ?? defaultStoreName;
  }

  private async getStore(instanceId: string): Promise<LocalForage | undefined> {
    if (!instanceId) return undefined;
    const name = this.resolveStoreName(instanceId);
    let store = this.stores.get(name);
    if (!store) {
      const localforage = await getLocalforage();
      store = localforage.createInstance({ name });
      this.stores.set(name, store);
    }
    return store;
  }

  getAsync = async (instanceId: string, key: string): Promise<any> => {
    const store = await this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.getItem(key);
  };

  setAsync = async (
    instanceId: string,
    key: string,
    value: any
  ): Promise<void> => {
    const store = await this.getStore(instanceId);
    if (!store) return Promise.reject();
    await store.setItem(key, value);
  };

  deleteAsync = async (instanceId: string, key: string): Promise<void> => {
    const store = await this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.removeItem(key);
  };

  keysAsync = async (instanceId: string): Promise<string[]> => {
    const store = await this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.keys();
  };

  dropStore = async (instanceId: string): Promise<void> => {
    const store = await this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.dropInstance().finally(() => {
      this.stores.delete(this.resolveStoreName(instanceId));
    });
  };

  /**
   * A view of this storage locked to a single `instanceId`. Expose **this** to
   * a plugin VM rather than the raw {@link ClientStorage}: its methods take no
   * `instanceId`, so plugin code cannot address another instance's store.
   */
  scoped = (instanceId: string): ScopedClientStorage => ({
    getAsync: (key) => this.getAsync(instanceId, key),
    setAsync: (key, value) => this.setAsync(instanceId, key, value),
    deleteAsync: (key) => this.deleteAsync(instanceId, key),
    keysAsync: () => this.keysAsync(instanceId),
    dropStore: () => this.dropStore(instanceId)
  });
}
