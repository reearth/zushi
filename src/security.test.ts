import { describe, expect, test } from "vitest";

import { Sandbox, quickjs } from "./runtime";

/**
 * Sandbox-escape tests. These verify that untrusted plugin code running in the
 * QuickJS VM cannot reach host globals, host internals, or pollute host state.
 */
describe("sandbox escape", () => {
  test("host globals (window/document/fetch/process) are unreachable", async () => {
    const out: Record<string, string> = {};
    const sandbox = new Sandbox({
      backend: quickjs(),
      exposed: { report: (k: string, v: string) => (out[k] = v) },
      code: `
        report("window", typeof window);
        report("document", typeof document);
        report("fetch", typeof fetch);
        report("process", typeof process);
        report("XMLHttpRequest", typeof XMLHttpRequest);
        report("localStorage", typeof localStorage);
      `
    });
    await sandbox.start();
    expect(out.window).toBe("undefined");
    expect(out.document).toBe("undefined");
    expect(out.fetch).toBe("undefined");
    expect(out.process).toBe("undefined");
    expect(out.XMLHttpRequest).toBe("undefined");
    expect(out.localStorage).toBe("undefined");
    sandbox.dispose();
  });

  test("the Function constructor yields the VM global, not the host", async () => {
    const out: Record<string, any> = {};
    const sandbox = new Sandbox({
      backend: quickjs(),
      exposed: {
        report: (k: string, v: any) => (out[k] = v),
        host: { ping: () => "pong" }
      },
      code: `
        // Reach the constructor of a marshaled host function.
        const F = host.ping.constructor;
        report("doc", F("return typeof document")());
        const glob = F("return this")();
        report("hasWindow", typeof glob.window);
        report("hasProcess", typeof glob.process);
      `
    });
    await sandbox.start();
    expect(out.doc).toBe("undefined");
    expect(out.hasWindow).toBe("undefined");
    expect(out.hasProcess).toBe("undefined");
    sandbox.dispose();
  });

  test("prototype pollution inside the VM does not affect the host", async () => {
    const sandbox = new Sandbox({
      backend: quickjs(),
      code: `
        Object.prototype.__pwned = "yes";
        Array.prototype.__pwned2 = "yes";
      `
    });
    await sandbox.start();
    expect(({} as any).__pwned).toBeUndefined();
    expect(([] as any).__pwned2).toBeUndefined();
    sandbox.dispose();
  });

  test("host class instances cross only as detached JSON clones (no live reference, methods, or host prototype)", async () => {
    // A host object explicitly returned to the plugin is deep-cloned by value
    // (the default `|| "json"` marshaling). This is the security boundary:
    // enumerable data may cross, but the host's prototype, methods, and the
    // live reference do NOT — so the plugin cannot call host behavior or mutate
    // host state through the returned value.
    class Secret {
      token = "s3cr3t";
      reveal() {
        return this.token;
      }
    }
    const instance = new Secret();
    const out: Record<string, any> = {};
    const sandbox = new Sandbox({
      backend: quickjs(),
      exposed: {
        getSecret: () => instance,
        report: (k: string, v: any) => (out[k] = v)
      },
      code: `
        const s = getSecret();
        report("hasReveal", typeof s.reveal);                 // method stripped
        report("ctorName", s.constructor && s.constructor.name); // VM Object
        s.token = "mutated-by-plugin";                        // must not reach host
      `
    });
    await sandbox.start();
    expect(out.hasReveal).toBe("undefined"); // methods do not cross
    expect(out.ctorName).toBe("Object"); // not the host Secret prototype
    expect(instance.token).toBe("s3cr3t"); // host state untouched (no live ref)
    sandbox.dispose();
  });

  test("host objects passed in are not mutable back through the bridge in a way that exposes prototypes", async () => {
    const hostState = { value: 1 };
    const out: Record<string, any> = {};
    const sandbox = new Sandbox({
      backend: quickjs(),
      exposed: {
        state: hostState,
        report: (k: string, v: any) => (out[k] = v)
      },
      code: `
        // Walking up the prototype chain must not reach a host realm object.
        const proto = Object.getPrototypeOf(state);
        report("protoIsObject", proto === Object.prototype);
        report("ctorName", state.constructor && state.constructor.name);
      `
    });
    await sandbox.start();
    // Inside the VM the prototype is the VM's Object.prototype, named "Object".
    expect(out.protoIsObject).toBe(true);
    expect(out.ctorName).toBe("Object");
    sandbox.dispose();
  });
});
