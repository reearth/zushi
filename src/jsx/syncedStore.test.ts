import { describe, expect, test, vi } from "vitest";

import { SyncedStore } from "./syncedStore";
import type { ClientStorage } from "../storage";

describe("SyncedStore", () => {
  test("get/set/has/keys/delete and seeded initial values", () => {
    const store = new SyncedStore({ initial: { a: 1 } });
    expect(store.get("a")).toBe(1);
    expect(store.has("a")).toBe(true);
    store.set("b", 2);
    expect(store.keys().sort()).toEqual(["a", "b"]);
    store.delete("a");
    expect(store.has("a")).toBe(false);
  });

  test("notifies all-key and per-key subscribers, and skips no-op sets", () => {
    const store = new SyncedStore();
    const all = vi.fn();
    const onA = vi.fn();
    store.subscribe(all);
    store.subscribeKey("a", onA);

    store.set("a", 1);
    expect(all).toHaveBeenCalledWith("a", 1);
    expect(onA).toHaveBeenCalledTimes(1);

    store.set("b", 2);
    expect(onA).toHaveBeenCalledTimes(1); // unaffected by another key
    expect(all).toHaveBeenCalledTimes(2);

    store.set("a", 1); // same value → no notify
    expect(onA).toHaveBeenCalledTimes(1);
  });

  test("unsubscribe stops notifications", () => {
    const store = new SyncedStore();
    const cb = vi.fn();
    const off = store.subscribeKey("a", cb);
    store.set("a", 1);
    off();
    store.set("a", 2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test("persists writes and hydrates from storage", async () => {
    const backing = new Map<string, unknown>([["x", 10]]);
    const storage = {
      keysAsync: async () => [...backing.keys()],
      getAsync: async (_id: string, k: string) => backing.get(k),
      setAsync: async (_id: string, k: string, v: unknown) => void backing.set(k, v),
      deleteAsync: async (_id: string, k: string) => void backing.delete(k)
    } as unknown as ClientStorage;

    const store = new SyncedStore({ persist: true, storage, instanceId: "i1" });
    await store.hydrate();
    expect(store.get("x")).toBe(10); // loaded from storage

    store.set("y", 20);
    await Promise.resolve();
    expect(backing.get("y")).toBe(20); // written through
    store.delete("x");
    await Promise.resolve();
    expect(backing.has("x")).toBe(false);
  });
});
