import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PATCHER_HTML } from "./patcher";

// The patcher normally runs inside the sandboxed iframe. Here we instantiate it
// against jsdom's real DOM (extracting the IIFE from PATCHER_HTML, since the
// function itself isn't exported) and drive it through postMessage, so we can
// assert the reconciled DOM — in particular the dangerous-URL filtering.

const SCRIPT = PATCHER_HTML.match(/<script>([\s\S]*)<\/script>/)![1];

function render(tree: any[], gen = 1): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { __zushi: "render", g: gen, tree },
      source: window // in jsdom, window.parent === window
    })
  );
}

describe("patcher dangerous-URL filtering", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    root.id = "__zushi_root";
    document.body.appendChild(root);
    // Run the patcher IIFE; it grabs #__zushi_root and wires a message listener.
    (0, eval)(SCRIPT);
  });

  afterEach(() => {
    root.remove();
  });

  test("blocks javascript:, vbscript:, and data:text/html on href/src", () => {
    render([
      { t: "a", p: { href: "javascript:alert(1)" } },
      { t: "a", p: { href: "VBScript:msgbox(1)" } },
      { t: "a", p: { href: "  \t data:text/html,<script>x</script>" } },
      { t: "img", p: { src: "javascript:alert(2)" } },
      { t: "a", p: { href: "https://example.com/ok" } }
    ]);

    const nodes = root.childNodes;
    expect((nodes[0] as HTMLElement).getAttribute("href")).toBeNull();
    expect((nodes[1] as HTMLElement).getAttribute("href")).toBeNull();
    expect((nodes[2] as HTMLElement).getAttribute("href")).toBeNull();
    expect((nodes[3] as HTMLElement).getAttribute("src")).toBeNull();
    // Safe URLs still pass through.
    expect((nodes[4] as HTMLAnchorElement).href).toContain("example.com/ok");
  });

  test("blocks dangerous URLs on formaction, action, and xlink:href (case-insensitive)", () => {
    render([
      { t: "button", p: { formAction: "javascript:alert(1)" } },
      { t: "form", p: { action: "javascript:alert(2)" } },
      { t: "a", p: { "XLINK:HREF": "javascript:alert(3)" } }
    ]);

    const nodes = root.childNodes;
    expect((nodes[0] as HTMLElement).getAttribute("formAction")).toBeNull();
    expect((nodes[0] as HTMLElement).getAttribute("formaction")).toBeNull();
    expect((nodes[1] as HTMLElement).getAttribute("action")).toBeNull();
    expect((nodes[2] as HTMLElement).getAttribute("XLINK:HREF")).toBeNull();
  });

  test("ignores render messages whose source is not the parent window", () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __zushi: "render", g: 9, tree: [{ t: "span" }] },
        source: null // not window.parent -> ignored
      })
    );
    expect(root.querySelector("span")).toBeNull();
  });
});
