// Registers a global `indexedDB` so localforage has a backing driver under
// jsdom (which ships localStorage but no IndexedDB). Must be imported first.
import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "vitest";

import { ClientStorage } from "./clientStorage";

describe("ClientStorage", () => {
  let storage: ClientStorage;

  afterEach(async () => {
    await storage?.dropStore("a").catch(() => {});
    await storage?.dropStore("b").catch(() => {});
  });

  test("round-trips values and lists keys per instance", async () => {
    storage = new ClientStorage();
    await storage.setAsync("a", "k1", { n: 1 });
    await storage.setAsync("a", "k2", "two");
    expect(await storage.getAsync("a", "k1")).toEqual({ n: 1 });
    expect(await storage.getAsync("a", "k2")).toBe("two");
    expect((await storage.keysAsync("a")).sort()).toEqual(["k1", "k2"]);
  });

  test("delete removes a single key", async () => {
    storage = new ClientStorage();
    await storage.setAsync("a", "k", 1);
    await storage.deleteAsync("a", "k");
    expect(await storage.getAsync("a", "k")).toBeNull();
  });

  test("instances are isolated from each other", async () => {
    storage = new ClientStorage();
    await storage.setAsync("a", "k", "from-a");
    await storage.setAsync("b", "k", "from-b");
    expect(await storage.getAsync("a", "k")).toBe("from-a");
    expect(await storage.getAsync("b", "k")).toBe("from-b");
  });

  test("dropStore wipes an instance's store", async () => {
    storage = new ClientStorage();
    await storage.setAsync("a", "k", 1);
    await storage.dropStore("a");
    expect(await storage.keysAsync("a")).toEqual([]);
  });

  test("rejects when given an empty instance id", async () => {
    storage = new ClientStorage();
    await expect(storage.getAsync("", "k")).rejects.toBeUndefined();
  });

  test("honors a custom storeName resolver", async () => {
    storage = new ClientStorage({ storeName: (id) => `custom-${id}` });
    await storage.setAsync("a", "k", 42);
    expect(await storage.getAsync("a", "k")).toBe(42);
  });

  test("scoped view binds the instance id and can't reach another store", async () => {
    storage = new ClientStorage();
    await storage.setAsync("b", "secret", "from-b");
    const a = storage.scoped("a");
    await a.setAsync("k", "from-a");
    // Reads/writes only touch instance "a"; there is no id argument to forge.
    expect(await a.getAsync("k")).toBe("from-a");
    expect(await a.keysAsync()).toEqual(["k"]);
    // Instance "b"'s data is untouched and unreachable through the scoped view.
    expect(await storage.getAsync("b", "secret")).toBe("from-b");
    expect(await a.getAsync("secret")).toBeNull();
  });
});
