import { describe, expect, test } from "vitest";

import { merge } from "./merge";

describe("merge", () => {
  test("returns a copy of base when no override", () => {
    const base = { a: 1 };
    const out = merge(base);
    expect(out).toEqual({ a: 1 });
    expect(out).not.toBe(base);
  });

  test("override wins and inputs are not mutated", () => {
    const base = { a: 1, b: 2 };
    const override = { b: 3, c: 4 };
    expect(merge(base, override)).toEqual({ a: 1, b: 3, c: 4 });
    expect(base).toEqual({ a: 1, b: 2 });
  });

  test("merges nested plain objects recursively", () => {
    expect(merge({ x: { a: 1, b: 2 } }, { x: { b: 9, c: 3 } })).toEqual({
      x: { a: 1, b: 9, c: 3 }
    });
  });

  test("replaces (not merges) when either side is not a plain object", () => {
    const fn = () => {};
    expect(merge({ a: { x: 1 } }, { a: [1, 2] })).toEqual({ a: [1, 2] }); // array
    expect(merge({ a: 1 }, { a: fn }).a).toBe(fn); // function
    expect(merge({ a: { x: 1 } }, { a: null })).toEqual({ a: null }); // null
    expect(merge({ a: 1 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } }); // base primitive
  });
});
