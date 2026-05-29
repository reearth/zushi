import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Plugin } from "./plugin";
import { quickjs } from "./runtime";

describe("Plugin", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  test("hands declared surfaces to exposed and renders UI", async () => {
    const plugin = new Plugin({
      backend: quickjs(),
      surfaces: { main: { container } },
      code: `
        reearth.ui.show("<div>hello plugin</div>");
        reearth.console.log("loaded");
      `,
      exposed: ({ surfaces, messages, startEventLoop }) => ({
        // host wires the surface under its own "reearth" global
        reearth: {
          console: { log: (...a: any[]) => console.log(...a) },
          ui: surfaces.main.api,
          messages,
          startEventLoop
        }
      })
    });
    await plugin.start();

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.srcdoc).toContain("hello plugin");
    plugin.dispose();
  });

  test("plugin receives messages posted from its UI iframe", async () => {
    const received: any[] = [];
    const plugin = new Plugin({
      backend: quickjs(),
      surfaces: { ui: { container } },
      exposed: ({ surfaces }) => ({
        out: { record: (m: any) => received.push(m) },
        reearth: { ui: surfaces.ui.api }
      }),
      code: `
        reearth.ui.show("<div>x</div>");
        reearth.ui.on("message", (m) => out.record(m));
      `
    });
    await plugin.start();

    const iframe = container.querySelector("iframe")!;
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      value: { postMessage: () => {} }
    });
    iframe.dispatchEvent(new Event("load"));

    // Simulate the iframe posting a message back to the host.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { from: "iframe" },
        source: iframe.contentWindow as Window
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(received).toEqual([{ from: "iframe" }]);
    plugin.dispose();
  });

  test("creates a hidden container for a surface without one, and removes it on dispose", async () => {
    const before = document.body.querySelectorAll("div").length;
    const plugin = new Plugin({
      backend: quickjs(),
      surfaces: { ui: { container }, modal: {} }, // modal has no container
      code: `1;`
    });
    await plugin.start();
    // one hidden container was appended to body for "modal"
    expect(document.body.querySelectorAll("div").length).toBe(before + 1);
    plugin.dispose();
    expect(document.body.querySelectorAll("div").length).toBe(before);
  });

  test("seals registerComponent from plugin code by default", async () => {
    const seen: string[] = [];
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      surfaces: { ui: { container } },
      setup: `registerComponent("View", (p) => h("div", null, p.children));`,
      exposed: () => ({ probe: (t: string) => seen.push(t) }),
      // registerComponent is not in the default `zushi` namespace, but a
      // component registered by the trusted setup stays available (bare).
      code: `probe(typeof zushi.registerComponent); probe(typeof View);`
    });
    await plugin.start();
    expect(seen).toEqual(["undefined", "function"]);
    plugin.dispose();
  });

  test("exposeRegisterComponent puts it in the namespace for plugin code", async () => {
    const seen: string[] = [];
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      exposeRegisterComponent: true,
      surfaces: { ui: { container } },
      exposed: () => ({ probe: (t: string) => seen.push(t) }),
      code: `probe(typeof zushi.registerComponent);`
    });
    await plugin.start();
    expect(seen).toEqual(["function"]);
    plugin.dispose();
  });

  test("default namespace exposes the runtime API under `zushi`", async () => {
    const seen: Record<string, string> = {};
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      surfaces: { ui: { container } },
      exposed: () => ({ probe: (k: string, t: string) => (seen[k] = t) }),
      code: `
        probe("nsUseState", typeof zushi.useState);
        probe("nsRender", typeof zushi.render);
        probe("bareUseState", typeof useState);   // not bare by default
        probe("bridge", typeof __zushi);           // sealed after setup
      `
    });
    await plugin.start();
    expect(seen).toEqual({
      nsUseState: "function",
      nsRender: "function",
      bareUseState: "undefined",
      bridge: "undefined"
    });
    plugin.dispose();
  });

  test("namespace:false plants the runtime API as bare globals", async () => {
    const seen: Record<string, string> = {};
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      namespace: false,
      surfaces: { ui: { container } },
      exposed: () => ({ probe: (k: string, t: string) => (seen[k] = t) }),
      code: `
        probe("useState", typeof useState);
        probe("render", typeof render);
        probe("zushi", typeof zushi);   // no namespace object created
      `
    });
    await plugin.start();
    expect(seen).toEqual({
      useState: "function",
      render: "function",
      zushi: "undefined"
    });
    plugin.dispose();
  });

  test("runtime refs in exposed place the API at host-chosen paths", async () => {
    const seen: Record<string, string> = {};
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      surfaces: { ui: { container } },
      exposed: ({ runtime }) => ({
        probe: (k: string, t: string) => (seen[k] = t),
        reearth: { useState: runtime.useState, render: runtime.render }
      }),
      code: `
        probe("reearthUseState", typeof reearth.useState);
        probe("reearthRender", typeof reearth.render);
        probe("zushi", typeof zushi);   // default placement suppressed
      `
    });
    await plugin.start();
    expect(seen).toEqual({
      reearthUseState: "function",
      reearthRender: "function",
      zushi: "undefined"
    });
    plugin.dispose();
  });

  test("exposeBridge keeps __zushi reachable from plugin code", async () => {
    const seen: string[] = [];
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      exposeBridge: true,
      surfaces: { ui: { container } },
      exposed: () => ({ probe: (t: string) => seen.push(t) }),
      code: `probe(typeof __zushi); probe(typeof __zushi.runtime.useState);`
    });
    await plugin.start();
    expect(seen).toEqual(["object", "function"]);
    plugin.dispose();
  });

  test("creates no surfaces by default", async () => {
    const plugin = new Plugin({ backend: quickjs(), code: `1;` });
    await plugin.start();
    expect(Object.keys(plugin.surfaces)).toEqual([]);
    plugin.dispose();
  });
});
