import { describe, expect, test } from "vitest";

import * as zushi from "./index";

describe("package entry", () => {
  test("exposes the headline public API", () => {
    expect(typeof zushi.version).toBe("string");
    for (const name of [
      "Plugin",
      "Sandbox",
      "quickjs",
      "QuickJSBackend",
      "merge",
      "domRenderer",
      "reactRenderer",
      "hostReactRenderer",
      "SyncedStore"
    ] as const) {
      expect(zushi[name], name).toBeDefined();
    }
  });
});
