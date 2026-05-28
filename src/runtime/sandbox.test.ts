import { describe, expect, test, vi } from "vitest";

import { Sandbox, defaultIsMarshalable } from "./sandbox";

describe("Sandbox", () => {
  test("exposes a host API and evaluates plugin code", async () => {
    const calls: any[] = [];
    const sandbox = new Sandbox({
      code: `host.report(1 + 2); host.report("hello");`,
      exposed: { host: { report: (v: any) => calls.push(v) } }
    });
    await sandbox.start();
    expect(sandbox.loaded).toBe(true);
    expect(calls).toEqual([3, "hello"]);
    sandbox.dispose();
  });

  test("runs the async job loop so promises resolve", async () => {
    const results: any[] = [];
    const sandbox = new Sandbox({
      exposed: {
        host: {
          resolveValue: () => Promise.resolve(42),
          done: (v: any) => results.push(v)
        }
      },
      code: `
        (async () => {
          const v = await host.resolveValue();
          host.done(v);
        })();
      `
    });
    await sandbox.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(results).toEqual([42]);
    sandbox.dispose();
  });

  test("delivers messages to plugin listeners via the bridge", async () => {
    const received: any[] = [];
    const sandbox = new Sandbox({
      exposed: (bridge) => ({
        host: {
          onMessage: (cb: (m: any) => void) => bridge.messages.on(cb),
          record: (m: any) => received.push(m)
        }
      }),
      code: `host.onMessage((m) => host.record(m));`
    });
    await sandbox.start();
    sandbox.handleMessage({ hello: "world" });
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([{ hello: "world" }]);
    sandbox.dispose();
  });

  test("onMessage option is invoked for every message", async () => {
    const onMessage = vi.fn();
    const sandbox = new Sandbox({ code: `1;`, onMessage });
    await sandbox.start();
    sandbox.handleMessage({ a: 1 });
    expect(onMessage).toHaveBeenCalledWith({ a: 1 });
    sandbox.dispose();
  });

  test("dispose tears down the VM and stops accepting work", async () => {
    const sandbox = new Sandbox({ code: `1;` });
    await sandbox.start();
    expect(sandbox.arena()).toBeDefined();
    sandbox.dispose();
    expect(sandbox.arena()).toBeUndefined();
    expect(sandbox.loaded).toBe(false);
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
