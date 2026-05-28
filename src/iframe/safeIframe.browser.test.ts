import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SafeIFrame } from "./safeIframe";

// Real-browser tests (Vitest browser mode / Playwright Chromium). Unlike the
// jsdom unit tests, here the iframe actually loads its srcdoc, executes the
// injected scripts, and exchanges real cross-origin postMessages.

describe("SafeIFrame (real browser)", () => {
  let container: HTMLElement;
  let frame: SafeIFrame | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    frame?.dispose();
    frame = undefined;
    container.remove();
  });

  test("loads srcdoc, runs its script, and delivers a real postMessage", async () => {
    const messages: any[] = [];
    frame = new SafeIFrame({ container, onMessage: (m) => messages.push(m) });
    frame.render(
      `<body><script>parent.postMessage({ hello: "from-iframe" }, "*");</script></body>`
    );

    await vi.waitFor(
      () => expect(messages).toContainEqual({ hello: "from-iframe" }),
      { timeout: 3000 }
    );
  });

  test("round-trips a message: host -> iframe -> host", async () => {
    const messages: any[] = [];
    frame = new SafeIFrame({ container, onMessage: (m) => messages.push(m) });
    frame.render(
      `<body><script>
        window.addEventListener("message", (e) => {
          parent.postMessage({ echo: e.data }, "*");
        });
      </script></body>`
    );

    // Queued until load, then flushed to the real iframe.
    frame.postMessage({ ping: 42 });

    await vi.waitFor(
      () => expect(messages).toContainEqual({ echo: { ping: 42 } }),
      { timeout: 3000 }
    );
  });

  test("ResizeObserver script drives auto-resize and is intercepted (not surfaced as a message)", async () => {
    const messages: any[] = [];
    const onAutoResized = vi.fn();
    frame = new SafeIFrame({
      container,
      autoResize: "both",
      onMessage: (m) => messages.push(m)
    });
    frame.render(
      `<body style="margin:0"><div style="width:140px;height:70px"></div></body>`,
      { onAutoResized }
    );

    const iframe = container.querySelector("iframe")!;
    await vi.waitFor(() => expect(onAutoResized).toHaveBeenCalled(), {
      timeout: 3000
    });
    // The injected auto-resize message must be handled internally, not leaked.
    expect(messages).toEqual([]);
    // A concrete pixel size has been applied from the measurement.
    expect(iframe.style.width).toMatch(/px$/);
    expect(iframe.style.height).toMatch(/px$/);
  });

  test("iframe is sandboxed without allow-same-origin (host cannot read its document)", async () => {
    let loaded = false;
    frame = new SafeIFrame({ container, onLoad: () => (loaded = true) });
    frame.render(`<body><p>isolated</p></body>`);

    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");

    await vi.waitFor(() => expect(loaded).toBe(true), { timeout: 3000 });

    // Opaque-origin sandbox: cross-origin access to the document must fail.
    expect(() => (iframe.contentWindow as any).document.cookie).toThrow();
  });
});
