import { Plugin, quickjs } from "@reearth/zushi";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Regression guard for a quickjs-emscripten-sync dispose-time handle leak
// (fixed in qes 1.9.1). An iframe message reaching a VM `ui.on` callback that
// calls a host function used to leak one object handle marshalled via the
// `isMarshalable` "json" path; on dispose the QuickJS runtime aborted with
//   Aborted(Assertion failed: list_empty(&rt->gc_obj_list), JS_FreeRuntime)
// which Sandbox.dispose() swallows through console.debug. This test fails if
// that abort ever returns. Each iteration uses a fresh module (an abort poisons
// the module for any later context).

const N = 4;
const readyHtml = `<script>parent.postMessage({ type: "ready" }, "*");</script>`;

describe("dispose does not leak QuickJS handles", () => {
  let container: HTMLElement;
  let aborts: number;
  let lastAbort: boolean;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    aborts = 0;
    debugSpy = vi.spyOn(console, "debug").mockImplementation((...args) => {
      if (String(args[0]).includes("quickjs dispose error")) lastAbort = true;
    });
  });
  afterEach(() => {
    debugSpy.mockRestore();
    container.remove();
  });

  test("iframe message -> VM callback -> host call, then dispose", async () => {
    for (let i = 0; i < N; i++) {
      lastAbort = false;
      const f = vi.fn();
      const plugin = new Plugin({
        backend: quickjs({ module: newQuickJSWASMModuleFromVariant(variant) }),
        surfaces: { ui: { container } },
        exposed: ({ surfaces }) => ({ ui: surfaces.ui.api, host: { f } }),
        code: `ui.on("message", (m) => { if (m && m.type === "ready") host.f(); });
               ui.show(${JSON.stringify(readyHtml)});`
      });
      await plugin.start();
      await vi.waitFor(() => expect(f).toHaveBeenCalled(), { timeout: 2000 });
      plugin.dispose();
      if (lastAbort) aborts++;
      container.querySelector("iframe")?.remove();
    }
    expect(aborts).toBe(0);
  });
});
