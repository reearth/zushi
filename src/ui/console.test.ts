import { afterEach, describe, expect, test, vi } from "vitest";

import { createConsole } from "./console";

describe("createConsole", () => {
  afterEach(() => vi.restoreAllMocks());

  test("forwards each method to the host console", () => {
    const c = createConsole();
    for (const m of ["log", "error", "warn", "info"] as const) {
      const spy = vi.spyOn(console, m).mockImplementation(() => {});
      c[m]("hello", 1);
      expect(spy).toHaveBeenCalledWith("hello", 1);
    }
  });
});
