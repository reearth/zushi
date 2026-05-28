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

  test("exposes console/ui/modal/popup by default and renders UI", async () => {
    const plugin = new Plugin({
      container,
      code: `
        reearth.ui.show("<div>hello plugin</div>");
        reearth.console.log("loaded");
      `,
      exposed: ({ ui, modal, popup, messages, startEventLoop }) => ({
        // host wires everything under a "reearth" global
        reearth: {
          console: { log: (...a: any[]) => console.log(...a) },
          ui: ui.uiAPI,
          modal: modal.modalAPI,
          popup: popup.modalAPI,
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
    const plugin = new Plugin({
      container,
      exposed: ({ ui }) => ({
        out: { record: (m: any) => received.push(m) },
        reearth: { ui: ui.uiAPI }
      }),
      code: `
        reearth.ui.show("<div>x</div>");
        reearth.ui.on("message", (m) => out.record(m));
      `
    });
    const received: any[] = [];
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

  test("dispose removes auto-created modal/popup containers", async () => {
    const before = document.body.querySelectorAll("div").length;
    const plugin = new Plugin({ container, code: `1;` });
    await plugin.start();
    // two containers (modal + popup) were appended to body
    expect(document.body.querySelectorAll("div").length).toBe(before + 2);
    plugin.dispose();
    expect(document.body.querySelectorAll("div").length).toBe(before);
  });
});
