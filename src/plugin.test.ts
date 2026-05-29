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

  test("mounts a custom renderer's patcher into the surface iframe", async () => {
    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      surfaces: { ui: { container } },
      renderer: {
        name: "test",
        patcherHtml:
          '<!doctype html><html><body><div id="__zushi_root"></div>' +
          "<!--CUSTOM_RENDERER--></body></html>"
      },
      code: `
        const { h, render } = zushi;
        render(h("div", null, "hi"));
      `
    });
    await plugin.start();
    const iframe = container.querySelector("iframe");
    expect(iframe!.srcdoc).toContain("CUSTOM_RENDERER");
    plugin.dispose();
  });

  test("host renderer mounts into the container (no iframe) and round-trips events", async () => {
    let tree: any = null;
    let gen = 0;
    let fire: ((hid: number, type: string, payload: any, g: number) => void) | null =
      null;
    const clicked: any[] = [];

    const hostRenderer = {
      name: "fake",
      target: "host" as const,
      mount(_container: HTMLElement, ctx: { onEvent: any }) {
        fire = ctx.onEvent;
        return {
          render(t: any[], g: number) {
            tree = t;
            gen = g;
          },
          dispose() {}
        };
      }
    };

    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      renderer: hostRenderer,
      surfaces: { ui: { container } },
      exposed: () => ({ host: { clicked: () => clicked.push(1) } }),
      code: `
        const { h, render } = zushi;
        render(h("rect", { onClick: () => host.clicked() }));
      `
    });
    await plugin.start();

    // No iframe was created — the host renderer drew straight into the container.
    expect(container.querySelector("iframe")).toBeNull();
    // It received the serialized tree with the click listener.
    expect(tree?.[0]?.t).toBe("rect");
    const hid = tree[0].ev[0].h;

    // Firing that listener round-trips to the plugin's handler.
    fire!(hid, "click", {}, gen);
    await new Promise((r) => setTimeout(r, 10));
    expect(clicked).toEqual([1]);
    plugin.dispose();
  });

  test("useSyncedState shares state two-way with the host", async () => {
    let tree: any = null;
    let gen = 0;
    let fire: ((hid: number, type: string, payload: any, g: number) => void) | null =
      null;
    const hostRenderer = {
      name: "fake",
      target: "host" as const,
      mount(_c: HTMLElement, ctx: { onEvent: any }) {
        fire = ctx.onEvent;
        return {
          render(t: any[], g: number) {
            tree = t;
            gen = g;
          },
          dispose() {}
        };
      }
    };
    const text = () => tree?.[0]?.c?.[0]?.x;

    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      renderer: hostRenderer,
      surfaces: { ui: { container } },
      synced: { initial: { count: 1 } },
      code: `
        const { useSyncedState, h, render } = zushi;
        function App() {
          const [n, setN] = useSyncedState("count", 0);
          return h("button", { onClick: () => setN(n + 1) }, "n=" + n);
        }
        render(h(App));
      `
    });
    await plugin.start();

    // Seeded initial value is read on first render.
    expect(text()).toBe("n=1");
    expect(plugin.synced!.get("count")).toBe(1);

    // plugin → host: a click bumps the synced value the host can read.
    fire!(tree[0].ev[0].h, "click", {}, gen);
    await new Promise((r) => setTimeout(r, 20));
    expect(plugin.synced!.get("count")).toBe(2);
    expect(text()).toBe("n=2");

    // host → plugin: setting from the host re-renders the plugin.
    plugin.synced!.set("count", 9);
    await new Promise((r) => setTimeout(r, 20));
    expect(text()).toBe("n=9");
    plugin.dispose();
  });

  test("useSyncedMap stores a reactive map the host can read", async () => {
    let tree: any = null;
    let gen = 0;
    let fire: ((hid: number, type: string, payload: any, g: number) => void) | null =
      null;
    const hostRenderer = {
      name: "fake",
      target: "host" as const,
      mount(_c: HTMLElement, ctx: { onEvent: any }) {
        fire = ctx.onEvent;
        return {
          render(t: any[], g: number) {
            tree = t;
            gen = g;
          },
          dispose() {}
        };
      }
    };

    const plugin = new Plugin({
      backend: quickjs(),
      jsx: true,
      renderer: hostRenderer,
      surfaces: { ui: { container } },
      code: `
        const { useSyncedMap, h, render } = zushi;
        function App() {
          const items = useSyncedMap("items");
          return h("button", { onClick: () => items.set("a", 1) }, "size=" + items.size);
        }
        render(h(App));
      `
    });
    await plugin.start();
    expect(tree[0].c[0].x).toBe("size=0");

    fire!(tree[0].ev[0].h, "click", {}, gen);
    await new Promise((r) => setTimeout(r, 20));
    expect(tree[0].c[0].x).toBe("size=1");
    expect(plugin.synced!.get("items")).toEqual({ a: 1 });
    plugin.dispose();
  });

  test("creates no surfaces by default", async () => {
    const plugin = new Plugin({ backend: quickjs(), code: `1;` });
    await plugin.start();
    expect(Object.keys(plugin.surfaces)).toEqual([]);
    plugin.dispose();
  });
});
