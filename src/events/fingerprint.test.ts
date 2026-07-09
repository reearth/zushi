import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";
import { describe, expect, test } from "vitest";

import {
  getFunctionFingerprint,
  getFunctionFingerprintString,
  areFunctionsSame
} from "./fingerprint";

describe("function fingerprinting", () => {
  test("generates consistent fingerprints for identical functions", () => {
    const fn1 = function testFunction() {
      console.log("test");
    };
    const fn2 = function testFunction() {
      console.log("test");
    };

    const fp1 = getFunctionFingerprint(fn1);
    const fp2 = getFunctionFingerprint(fn2);

    expect(fp1.hash).toBe(fp2.hash);
    expect(areFunctionsSame(fn1, fn2)).toBe(true);
  });

  test("generates different fingerprints for different functions", () => {
    const fn1 = function testFunction() {
      console.log("test1");
    };
    const fn2 = function testFunction() {
      console.log("test2");
    };

    const fp1 = getFunctionFingerprint(fn1);
    const fp2 = getFunctionFingerprint(fn2);

    expect(fp1.hash).not.toBe(fp2.hash);
    expect(areFunctionsSame(fn1, fn2)).toBe(false);
  });

  test("CRITICAL: same fingerprint for QuickJS function before and after marshaling", async () => {
    const ctx = (await getQuickJS()).newContext();
    const arena = new Arena(ctx, { isMarshalable: true });

    // Create a function in QuickJS and get it multiple times
    arena.evalCode(`
      globalThis.myTestFunction = function clickHandler() {
        console.log('button clicked');
        return 42;
      };
    `);

    // Get the function multiple times - these will be different JS objects
    const fn1 = arena.evalCode(`myTestFunction`);
    const fn2 = arena.evalCode(`myTestFunction`);
    const fn3 = arena.evalCode(`myTestFunction`);

    // Verify they are different objects (the original problem)
    expect(fn1).not.toBe(fn2);
    expect(fn2).not.toBe(fn3);

    // BUT their fingerprints should be identical!
    const fp1 = getFunctionFingerprintString(fn1);
    const fp2 = getFunctionFingerprintString(fn2);
    const fp3 = getFunctionFingerprintString(fn3);

    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
    expect(areFunctionsSame(fn1, fn2)).toBe(true);
    expect(areFunctionsSame(fn2, fn3)).toBe(true);

    // Test the detailed fingerprint
    const detailed1 = getFunctionFingerprint(fn1);
    const detailed2 = getFunctionFingerprint(fn2);

    expect(detailed1.name).toBe(detailed2.name);
    expect(detailed1.source).toBe(detailed2.source);
    expect(detailed1.length).toBe(detailed2.length);
    expect(detailed1.hash).toBe(detailed2.hash);

    arena.dispose();
    ctx.dispose();
  });
});
