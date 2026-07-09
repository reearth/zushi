import { describe, expect, test } from "vitest";

import { Sandbox } from "./sandbox";
import { quickjs, QuickJSBackend, defaultIsMarshalable } from "./quickjs";

describe("QuickJSBackend", () => {
  test("backend identity", () => {
    const backend = new QuickJSBackend();
    expect(backend.name).toBe("quickjs");
    expect(backend.language).toBe("js");
  });

  test('default "json" snapshots values the default rule rejects', async () => {
    class Foo {
      x = 1;
    }
    const seen: any[] = [];
    const sandbox = new Sandbox({
      backend: quickjs(),
      exposed: { host: { foo: new Foo(), report: (v: any) => seen.push(v) } },
      code: `host.report(host.foo && host.foo.x);`
    });
    await sandbox.start();
    expect(seen).toEqual([1]);
    sandbox.dispose();
  });

  test("isMarshalable: false leaves those values unmarshaled", async () => {
    class Foo {
      x = 1;
    }
    const seen: any[] = [];
    const sandbox = new Sandbox({
      backend: quickjs({ isMarshalable: false }),
      exposed: { host: { foo: new Foo(), report: (v: any) => seen.push(v) } },
      code: `host.report(typeof host.foo);`
    });
    await sandbox.start();
    expect(seen).toEqual(["undefined"]);
    sandbox.dispose();
  });

  test("exposes the live arena as an escape hatch", async () => {
    const sandbox = new Sandbox({ backend: quickjs(), code: `1;` });
    await sandbox.start();
    const backend = sandbox.backend() as QuickJSBackend;
    expect(backend.arena).toBeDefined();
    expect(backend.context).toBeDefined();
    sandbox.dispose();
    expect(backend.arena).toBeUndefined();
  });

  test("interrupts runaway plugin code past the execution deadline", async () => {
    const backend = new QuickJSBackend({ maxExecutionMs: 50 });
    await backend.init();
    const start = Date.now();
    expect(() => backend.eval(`while (true) {}`)).toThrow();
    // Interrupted promptly rather than hanging the host indefinitely.
    expect(Date.now() - start).toBeLessThan(2000);
    backend.dispose();
  });

  test("routes an interrupted infinite loop to onError instead of hanging", async () => {
    const errors: any[] = [];
    const sandbox = new Sandbox({
      backend: quickjs({ maxExecutionMs: 50 }),
      code: `while (true) {}`,
      onError: (e) => errors.push(e)
    });
    await sandbox.start();
    expect(errors.length).toBe(1);
    sandbox.dispose();
  });

  test("enforces the VM memory limit", async () => {
    const backend = new QuickJSBackend({ memoryLimitBytes: 500_000 });
    await backend.init();
    expect(() =>
      backend.eval(`const a = []; while (true) { a.push(new Array(10000)); }`)
    ).toThrow();
    backend.dispose();
  });

  test("defaultIsMarshalable rejects class instances", () => {
    class Foo {
      x = 1;
    }
    expect(defaultIsMarshalable(new Foo())).toBe(false);
    expect(defaultIsMarshalable({ a: 1 })).toBe(true);
    expect(defaultIsMarshalable([1, 2])).toBe(true);
    expect(defaultIsMarshalable(42)).toBe(true);
    expect(defaultIsMarshalable(() => {})).toBe(true);
    expect(defaultIsMarshalable(new Date())).toBe(true);
  });
});
