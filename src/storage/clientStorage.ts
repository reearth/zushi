import localforage from "localforage";

export type ClientStorageAPI = {
  getAsync: (instanceId: string, key: string) => Promise<any>;
  setAsync: (instanceId: string, key: string, value: any) => Promise<void>;
  deleteAsync: (instanceId: string, key: string) => Promise<void>;
  keysAsync: (instanceId: string) => Promise<string[]>;
  dropStore: (instanceId: string) => Promise<void>;
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
 */
export class ClientStorage implements ClientStorageAPI {
  private stores = new Map<string, LocalForage>();
  private resolveStoreName: (instanceId: string) => string;

  constructor(options: ClientStorageOptions = {}) {
    this.resolveStoreName = options.storeName ?? defaultStoreName;
  }

  private getStore(instanceId: string): LocalForage | undefined {
    if (!instanceId) return undefined;
    const name = this.resolveStoreName(instanceId);
    let store = this.stores.get(name);
    if (!store) {
      store = localforage.createInstance({ name });
      this.stores.set(name, store);
    }
    return store;
  }

  getAsync = (instanceId: string, key: string): Promise<any> => {
    const store = this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.getItem(key);
  };

  setAsync = (instanceId: string, key: string, value: any): Promise<void> => {
    const store = this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.setItem(key, value).then(() => undefined);
  };

  deleteAsync = (instanceId: string, key: string): Promise<void> => {
    const store = this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.removeItem(key);
  };

  keysAsync = (instanceId: string): Promise<string[]> => {
    const store = this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.keys();
  };

  dropStore = (instanceId: string): Promise<void> => {
    const store = this.getStore(instanceId);
    if (!store) return Promise.reject();
    return store.dropInstance().finally(() => {
      this.stores.delete(this.resolveStoreName(instanceId));
    });
  };
}
