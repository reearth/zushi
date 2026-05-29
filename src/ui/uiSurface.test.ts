import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { UISurface } from "./uiSurface";

describe("UISurface", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  test("show renders HTML into a sandboxed iframe in the container", () => {
    const s = new UISurface({ container });
    s.show("<p>hello surface</p>");
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe!.srcdoc).toContain("hello surface");
    s.dispose();
  });

  test("close emits a close event to subscribers; off detaches", () => {
    const s = new UISurface({ container });
    s.show("<p>x</p>");
    const onClose = vi.fn();
    s.on("close", onClose);
    s.close();
    expect(onClose).toHaveBeenCalledTimes(1);

    const onClose2 = vi.fn();
    s.on("close", onClose2);
    s.off("close", onClose2);
    s.close();
    expect(onClose2).not.toHaveBeenCalled();
    s.dispose();
  });

  test("update / resize / postMessage are callable without throwing", () => {
    const s = new UISurface({ container });
    s.show("<p>x</p>", { width: 100, height: 50 });
    expect(() => s.resize(120, 80)).not.toThrow();
    expect(() => s.update({ visible: false })).not.toThrow();
    expect(() => s.postMessage({ hi: 1 })).not.toThrow();
    expect(s.api.show).toBe(s.show);
    s.dispose();
  });
});
