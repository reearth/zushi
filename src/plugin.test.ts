import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Plugin } from "./plugin";

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
      surfaces: { ui: { container }, modal: {} }, // modal has no container
      code: `1;`
    });
    await plugin.start();
    // one hidden container was appended to body for "modal"
    expect(document.body.querySelectorAll("div").length).toBe(before + 1);
    plugin.dispose();
    expect(document.body.querySelectorAll("div").length).toBe(before);
  });

  test("creates no surfaces by default", async () => {
    const plugin = new Plugin({ code: `1;` });
    await plugin.start();
    expect(Object.keys(plugin.surfaces)).toEqual([]);
    plugin.dispose();
  });
});
