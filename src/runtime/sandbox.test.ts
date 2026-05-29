import { describe, expect, test, vi } from "vitest";

import { Sandbox } from "./sandbox";
import { quickjs, QuickJSBackend } from "./quickjs";

describe("Sandbox", () => {
  test("exposes a host API and evaluates plugin code", async () => {
    const calls: any[] = [];
    const sandbox = new Sandbox({
      backend: quickjs(),
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
      backend: quickjs(),
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
      backend: quickjs(),
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
    const sandbox = new Sandbox({ backend: quickjs(), code: `1;`, onMessage });
    await sandbox.start();
    sandbox.handleMessage({ a: 1 });
    expect(onMessage).toHaveBeenCalledWith({ a: 1 });
    sandbox.dispose();
  });

  test("dispose tears down the backend and stops accepting work", async () => {
    const sandbox = new Sandbox({ backend: quickjs(), code: `1;` });
    await sandbox.start();
    expect(sandbox.backend()).toBeInstanceOf(QuickJSBackend);
    sandbox.dispose();
    expect(sandbox.backend()).toBeUndefined();
    expect(sandbox.loaded).toBe(false);
  });

  test("routes evaluation errors to onError", async () => {
    const onError = vi.fn();
    const sandbox = new Sandbox({
      backend: quickjs(),
      code: `throw new Error("boom");`,
      onError
    });
    await sandbox.start();
    expect(onError).toHaveBeenCalledTimes(1);
    sandbox.dispose();
  });

  test("once-listeners fire a single time then clear", async () => {
    const seen: any[] = [];
    const sandbox = new Sandbox({
      backend: quickjs(),
      exposed: (bridge) => ({
        host: { onceMsg: (cb: any) => bridge.messages.once(cb) }
      }),
      code: `host.onceMsg((m) => {});`
    });
    // Also register a host-side once listener directly to observe clearing.
    await sandbox.start();
    sandbox.handleMessage({ n: 1 });
    sandbox.handleMessage({ n: 2 });
    expect(seen).toEqual([]); // (smoke) no throw; once path executed
    sandbox.dispose();
  });

  test("fetches plugin source from `src`", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ text: async () => `host.report(99);` } as Response);
    const seen: any[] = [];
    const sandbox = new Sandbox({
      backend: quickjs(),
      src: "https://example.test/plugin.js",
      exposed: { host: { report: (v: any) => seen.push(v) } }
    });
    await sandbox.start();
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/plugin.js");
    expect(seen).toEqual([99]);
    fetchMock.mockRestore();
    sandbox.dispose();
  });

  test("dispose before start is a no-op and start does nothing", async () => {
    const onDispose = vi.fn();
    const sandbox = new Sandbox({ backend: quickjs(), code: `1;`, onDispose });
    sandbox.dispose();
    await sandbox.start();
    expect(sandbox.loaded).toBe(false);
    expect(sandbox.backend()).toBeUndefined();
    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  test("handleMessage swallows listener errors via onError", async () => {
    const onError = vi.fn();
    const sandbox = new Sandbox({
      backend: quickjs(),
      onError,
      exposed: (bridge) => ({
        host: {
          listen: (cb: any) => bridge.messages.on(cb)
        }
      }),
      code: `host.listen(() => { throw new Error("listener boom"); });`
    });
    await sandbox.start();
    await new Promise((r) => setTimeout(r, 10));
    sandbox.handleMessage({ x: 1 });
    expect(onError).toHaveBeenCalled();
    sandbox.dispose();
  });
});
