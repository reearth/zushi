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
