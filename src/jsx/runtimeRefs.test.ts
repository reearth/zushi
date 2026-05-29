import { describe, expect, test } from "vitest";

import { makeRuntimeRefs, extractPlacements } from "./runtimeRefs";
import { RUNTIME_API_NAMES } from "./protocol";

describe("runtime refs", () => {
  test("makeRuntimeRefs exposes a token per runtime API name", () => {
    const refs = makeRuntimeRefs() as Record<string, unknown>;
    for (const name of RUNTIME_API_NAMES) expect(refs[name]).toBeDefined();
  });

  test("extractPlacements pulls refs out of objects and arrays, keeps host values", () => {
    const refs = makeRuntimeRefs() as Record<string, unknown>;
    const tree: any = {
      host: { fn: () => {} },
      reearth: { useState: refs.useState, ui: { label: "x" } },
      list: [refs.render, { keep: 1 }]
    };
    const placements = extractPlacements(tree);

    // Tokens were removed from the tree...
    expect(tree.reearth.useState).toBeUndefined();
    expect(tree.list[0]).toBeUndefined();
    // ...while real host values stay.
    expect(typeof tree.host.fn).toBe("function");
    expect(tree.reearth.ui.label).toBe("x");
    expect(tree.list[1]).toEqual({ keep: 1 });

    // ...and their paths + names were recorded (including the array index).
    expect(placements).toContainEqual({ path: ["reearth", "useState"], name: "useState" });
    expect(placements).toContainEqual({ path: ["list", "0"], name: "render" });
  });

  test("no refs → no placements", () => {
    expect(extractPlacements({ a: 1, b: { c: 2 } })).toEqual([]);
  });
});
