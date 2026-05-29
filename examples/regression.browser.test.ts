import { Plugin, quickjs } from "@reearth/zushi";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { pluginSource } from "./src/pluginSource";
import { quickjsModule } from "./src/quickjs";

const backend = quickjs({ module: quickjsModule });

// Drives the example's real plugin end-to-end in a real browser: the plugin
// runs in QuickJS, renders into a real sandboxed iframe, and exchanges real
// postMessages in both directions. Doubles as the example and as a regression
// test for the whole pipeline.

describe("example plugin (regression)", () => {
  let container: HTMLElement;
  let plugin: Plugin | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    plugin?.dispose();
    plugin = undefined;
    container.remove();
  });

  test("click -> VM -> host -> iframe round trip", async () => {
    const increment = vi.fn((n: number) => n + 1);
    const event = vi.fn();

    plugin = new Plugin({
      code: pluginSource,
      backend,
      surfaces: { ui: { container, autoResize: "both" } },
      exposed: ({ surfaces }) => ({
        ui: surfaces.ui.api,
        host: { increment, event }
      })
    });
    await plugin.start();

    // The real iframe loaded and its script ran (it posts "ready" on load).
    await vi.waitFor(() => expect(event).toHaveBeenCalledWith("ready"), {
      timeout: 3000
    });

    // Simulate the "+1" button: the iframe posts { type: "inc" } to the parent.
    const iframe = container.querySelector("iframe")!;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "inc" },
        source: iframe.contentWindow as Window
      })
    );

    // Host API was invoked by the VM...
    await vi.waitFor(() => expect(increment).toHaveBeenCalledWith(0), {
      timeout: 3000
    });

    // ...and the new count round-tripped back through the real iframe, which
    // echoes "rendered" once it has displayed the value.
    await vi.waitFor(() => expect(event).toHaveBeenCalledWith("rendered", 1), {
      timeout: 3000
    });
  });
});
