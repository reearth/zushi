import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SafeIFrame } from "./safeIframe";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// jsdom does not load srcdoc, so manually fire the load event and stub the
// content window's postMessage to capture what reaches the iframe.
function setupContentWindow(iframe: HTMLIFrameElement) {
  const received: any[] = [];
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: { postMessage: (msg: any) => received.push(msg) }
  });
  return received;
}

describe("SafeIFrame", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  test("creates a sandboxed iframe without allow-same-origin", () => {
    const frame = new SafeIFrame({ container });
    frame.render("<div>hi</div>");
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    frame.dispose();
  });

  test("injects the auto-resize script into srcdoc", () => {
    const frame = new SafeIFrame({ container });
    frame.render("<body><p>x</p></body>");
    const iframe = container.querySelector("iframe")!;
    expect(iframe.srcdoc).toContain("_niche_resize");
    expect(iframe.srcdoc).toContain("ResizeObserver");
    frame.dispose();
  });

  test("queues messages until loaded, then flushes them", async () => {
    const frame = new SafeIFrame({ container });
    frame.render("<div>x</div>");
    const iframe = container.querySelector("iframe")!;
    const received = setupContentWindow(iframe);

    // Not loaded yet: messages are queued, not delivered.
    frame.postMessage({ a: 1 });
    frame.postMessage({ b: 2 });
    expect(received).toEqual([]);

    // Fire load: queue flushes in order.
    iframe.dispatchEvent(new Event("load"));
    expect(received).toEqual([{ a: 1 }, { b: 2 }]);

    // Subsequent messages go straight through.
    frame.postMessage({ c: 3 });
    expect(received).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    frame.dispose();
  });

  test("ignores messages whose source is not the iframe", async () => {
    const onMessage = vi.fn();
    const frame = new SafeIFrame({ container, onMessage });
    frame.render("<div>x</div>");
    const iframe = container.querySelector("iframe")!;
    setupContentWindow(iframe);

    // A message from an unrelated source must be ignored.
    window.dispatchEvent(
      new MessageEvent("message", { data: { evil: true }, source: window })
    );
    await flush();
    expect(onMessage).not.toHaveBeenCalled();

    // A message from the iframe's contentWindow is delivered.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ok: true },
        source: iframe.contentWindow as Window
      })
    );
    await flush();
    expect(onMessage).toHaveBeenCalledWith({ ok: true });
    frame.dispose();
  });

  test("auto-resize message updates size and fires callback", () => {
    const onAutoResized = vi.fn();
    const frame = new SafeIFrame({ container, autoResize: "both" });
    frame.render("<div>x</div>", { onAutoResized });
    const iframe = container.querySelector("iframe")!;
    setupContentWindow(iframe);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ["___iframe_auto_resize___"]: { width: 120, height: 80 } },
        source: iframe.contentWindow as Window
      })
    );

    expect(onAutoResized).toHaveBeenCalled();
    expect(iframe.style.width).toBe("120px");
    expect(iframe.style.height).toBe("80px");
    frame.dispose();
  });

  test("visibility toggles display and dimensions", () => {
    const frame = new SafeIFrame({ container });
    frame.render("<div>x</div>", { visible: true });
    const iframe = container.querySelector("iframe")!;
    expect(iframe.style.display).toBe("block");
    expect(iframe.style.width).toBe("100%");

    frame.setVisible(false);
    expect(iframe.style.display).toBe("none");
    expect(iframe.style.width).toBe("0px");
    frame.dispose();
  });
});
