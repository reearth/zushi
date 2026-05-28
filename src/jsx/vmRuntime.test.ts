import { describe, expect, test } from "vitest";

import { Sandbox } from "../runtime";
import { VM_RUNTIME_SOURCE } from "./vmRuntime";
import type { RenderPayload } from "./protocol";

/**
 * Exercises the in-VM JSX runtime in isolation: a fake `__zushi` bridge
 * captures the serialized trees it pushes and the dispatch fn it registers, so
 * we can drive renders and synthetic events without an iframe or DOM.
 */
type Dispatch = (
  surfaceId: string,
  hid: number,
  type: string,
  payload: unknown,
  g: number
) => void;

function harness(
  code: string,
  opts: { components?: string; intrinsics?: any } = {}
) {
  const renders: (RenderPayload & { surface: string })[] = [];
  const errors: any[] = [];
  let dispatch: Dispatch | undefined;

  const sandbox = new Sandbox({
    bootstrap:
      VM_RUNTIME_SOURCE + (opts.components ? "\n;" + opts.components : ""),
    exposed: {
      console: { error: (...a: any[]) => errors.push(a) },
      __zushi: {
        config: { intrinsics: opts.intrinsics ?? true },
        render: (surface: string, payload: RenderPayload) =>
          renders.push({ ...payload, surface }),
        ready: (fn: Dispatch) => {
          dispatch = fn;
        }
      }
    },
    code
  });

  const last = (surface = "ui") =>
    [...renders].reverse().find((r) => r.surface === surface);

  return {
    sandbox,
    renders,
    errors,
    last,
    rawDispatch(
      hid: number,
      type: string,
      payload: unknown,
      g: number,
      surface = "ui"
    ) {
      dispatch?.(surface, hid, type, payload, g);
      sandbox.requestEventLoop();
    },
    dispatchEvent(hid: number, type: string, payload: unknown, surface = "ui") {
      const g = last(surface)!.g;
      dispatch?.(surface, hid, type, payload, g);
      sandbox.requestEventLoop();
    }
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("vm jsx runtime", () => {
  test("renders intrinsic elements to a serialized tree", async () => {
    const h = harness(`render(createElement("div", { id: "a" }, "hello"));`);
    await h.sandbox.start();

    expect(h.renders).toHaveLength(1);
    expect(h.renders[0].tree).toEqual([
      { t: "div", p: { id: "a" }, ev: [], c: [{ x: "hello" }] }
    ]);
    h.sandbox.dispose();
  });

  test("flattens fragments and skips null children", async () => {
    const h = harness(`
      render(createElement(Fragment, null,
        createElement("span", null, "a"),
        false,
        createElement("span", null, "b")
      ));
    `);
    await h.sandbox.start();

    expect(h.renders[0].tree).toEqual([
      { t: "span", p: {}, ev: [], c: [{ x: "a" }] },
      { t: "span", p: {}, ev: [], c: [{ x: "b" }] }
    ]);
    h.sandbox.dispose();
  });

  test("useState re-renders on a dispatched event", async () => {
    const h = harness(`
      function Counter() {
        const [n, setN] = useState(0);
        return createElement("button", { onClick: () => setN(n + 1) }, "count:" + n);
      }
      render(createElement(Counter, null));
    `);
    await h.sandbox.start();

    const first = h.renders[0].tree[0] as any;
    expect(first.c[0].x).toBe("count:0");
    expect(first.ev).toEqual([{ t: "click", h: 1 }]);

    h.dispatchEvent(1, "click", {});
    await tick();

    expect(h.renders.length).toBeGreaterThanOrEqual(2);
    const last = h.renders[h.renders.length - 1].tree[0] as any;
    expect(last.c[0].x).toBe("count:1");
    h.sandbox.dispose();
  });

  test("event handler receives the serialized payload", async () => {
    const h = harness(`
      function Input() {
        const [v, setV] = useState("");
        return createElement("input", { value: v, onInput: (e) => setV(e.value) });
      }
      render(createElement(Input, null));
    `);
    await h.sandbox.start();

    const hid = (h.renders[0].tree[0] as any).ev[0].h;
    h.dispatchEvent(hid, "input", { value: "typed" });
    await tick();

    const last = h.renders[h.renders.length - 1].tree[0] as any;
    expect(last.p.value).toBe("typed");
    h.sandbox.dispose();
  });

  test("stale-generation events are ignored", async () => {
    const h = harness(`
      function C() {
        const [n, setN] = useState(0);
        return createElement("button", { onClick: () => setN(n + 1) }, "n:" + n);
      }
      render(createElement(C, null));
    `);
    await h.sandbox.start();

    const g0 = h.renders[0].g;
    // A valid event bumps to a newer generation.
    h.dispatchEvent(1, "click", {});
    await tick();
    const countAfterValid = h.renders.length;
    const valueAfterValid = (h.renders[h.renders.length - 1].tree[0] as any).c[0]
      .x;

    // Replaying the now-stale generation must be dropped (no extra render).
    h.rawDispatch(1, "click", {}, g0);
    await tick();
    expect(h.renders.length).toBe(countAfterValid);
    expect((h.renders[h.renders.length - 1].tree[0] as any).c[0].x).toBe(
      valueAfterValid
    );
    h.sandbox.dispose();
  });

  test("stamps keys on serialized nodes for the keyed diff", async () => {
    const h = harness(`
      render(createElement("ul", null,
        createElement("li", { key: "a" }, "A"),
        createElement("li", { key: "b" }, "B")
      ));
    `);
    await h.sandbox.start();

    const ul = h.renders[0].tree[0] as any;
    expect(ul.c.map((n: any) => n.k)).toEqual(["a", "b"]);
    h.sandbox.dispose();
  });

  test("renders to a non-default surface", async () => {
    const h = harness(`render(createElement("div", null, "modal"), { surface: "modal" });`);
    await h.sandbox.start();

    expect(h.renders).toHaveLength(1);
    expect(h.renders[0].surface).toBe("modal");
    h.sandbox.dispose();
  });

  test("registered components render and may emit intrinsics under intrinsics:false", async () => {
    const h = harness(
      `
        render(
          h(View, { spacing: 8 },
            h(Text, null, "hi"))
        );
      `,
      {
        intrinsics: false,
        components: `
          registerComponent("View", (p) =>
            h("div", { style: { display: "flex", gap: p.spacing } }, p.children));
          registerComponent("Text", (p) => h("span", null, p.children));
        `
      }
    );
    await h.sandbox.start();

    const root = h.renders[0].tree[0] as any;
    expect(root.t).toBe("div");
    expect(root.p.style).toEqual({ display: "flex", gap: 8 });
    expect(root.c[0].t).toBe("span");
    expect(root.c[0].c[0].x).toBe("hi");
    h.sandbox.dispose();
  });

  test("intrinsics:false rejects raw HTML authored in plugin code", async () => {
    const h = harness(`render(createElement("div", null, "nope"));`, {
      intrinsics: false
    });
    await h.sandbox.start();

    // The forbidden tag throws during render, so nothing is pushed.
    expect(h.renders).toHaveLength(0);
    expect(h.errors.length).toBeGreaterThan(0);
    h.sandbox.dispose();
  });
});
