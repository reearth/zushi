import { Plugin } from "@reearth/zushi";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { jsxComponents, jsxPluginSource } from "../../examples/src/jsxPluginSource";
import { quickjs } from "../../examples/src/quickjs";

// Drives the opt-in JSX runtime end-to-end in a real browser: a component with
// useState renders through the in-VM runtime into a real sandboxed iframe via
// the patcher, and a simulated DOM event round-trips back to the handler.
//
// The iframe is opaque-origin so its DOM can't be read from the parent; instead
// we observe (a) auto-resize firing, which only happens once the patcher has
// built real DOM, and (b) a host callback invoked by the event handler.

describe("jsx runtime (browser)", () => {
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

  test("renders via the patcher and round-trips an event", async () => {
    const clicked = vi.fn();

    plugin = new Plugin({
      jsx: true,
      surfaces: { ui: { container, autoResize: "both" } },
      quickjs,
      exposed: () => ({ host: { clicked } }),
      code: `
        function App() {
          const [n, setN] = useState(0);
          return createElement(
            "button",
            {
              style: { width: "120px", height: "40px" },
              onClick: () => { setN(n + 1); host.clicked(n + 1); }
            },
            "n:" + n
          );
        }
        render(createElement(App, null));
      `
    });
    await plugin.start();

    // The patcher built real DOM -> auto-resize sized the iframe element.
    const iframe = await vi.waitFor(
      () => {
        const el = container.querySelector("iframe") as HTMLIFrameElement;
        expect(el).toBeTruthy();
        expect(el.style.height).toMatch(/\d+px/);
        return el;
      },
      { timeout: 5000 }
    );

    // Simulate the patcher reporting a click. The first render is generation 1
    // and the first registered handler is hid 1 (deterministic walk order).
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __zushi: "event", hid: 1, type: "click", g: 1, payload: {} },
        source: iframe.contentWindow as Window
      })
    );

    await vi.waitFor(() => expect(clicked).toHaveBeenCalledWith(1), {
      timeout: 5000
    });
  });

  test("custom components render under intrinsics:false", async () => {
    const event = vi.fn();

    plugin = new Plugin({
      jsx: true,
      intrinsics: false, // plugin may only use registered components
      components: jsxComponents,
      surfaces: { ui: { container, autoResize: "both" } },
      quickjs,
      exposed: () => ({ host: { event } }),
      code: jsxPluginSource
    });
    await plugin.start();

    // Trusted View/Button/etc. produced real DOM -> the iframe got sized.
    const iframe = await vi.waitFor(
      () => {
        const el = container.querySelector("iframe") as HTMLIFrameElement;
        expect(el).toBeTruthy();
        expect(el.style.height).toMatch(/\d+px/);
        return el;
      },
      { timeout: 5000 }
    );

    // The "+1" button is the first registered handler (hid 1, generation 1).
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __zushi: "event", hid: 1, type: "click", g: 1, payload: {} },
        source: iframe.contentWindow as Window
      })
    );

    await vi.waitFor(() => expect(event).toHaveBeenCalledWith("inc", 1), {
      timeout: 5000
    });
  });
});
