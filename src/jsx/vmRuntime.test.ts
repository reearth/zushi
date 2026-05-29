import { describe, expect, test } from "vitest";

import { Sandbox, quickjs } from "../runtime";
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
  opts: { setup?: string; intrinsics?: any; exposed?: Record<string, any> } = {}
) {
  const renders: (RenderPayload & { surface: string })[] = [];
  const errors: any[] = [];
  let dispatch: Dispatch | undefined;

  const sandbox = new Sandbox({
    backend: quickjs(),
    bootstrap:
      VM_RUNTIME_SOURCE + (opts.setup ? "\n;" + opts.setup : ""),
    exposed: {
      ...opts.exposed,
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
        setup: `
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

  test("useReducer dispatches and re-renders", async () => {
    const h = harness(`
      function C() {
        const [n, dispatch] = useReducer((s, a) => (a === "inc" ? s + 1 : s), 0);
        return createElement("button", { onClick: () => dispatch("inc") }, "n:" + n);
      }
      render(createElement(C, null));
    `);
    await h.sandbox.start();
    expect((h.renders[0].tree[0] as any).c[0].x).toBe("n:0");

    h.dispatchEvent(1, "click", {});
    await tick();
    expect((h.last()!.tree[0] as any).c[0].x).toBe("n:1");
    h.sandbox.dispose();
  });

  test("useContext reads the nearest provider value (and the default)", async () => {
    const h = harness(`
      const Ctx = createContext("default");
      function Child() {
        return createElement("span", null, useContext(Ctx));
      }
      render(createElement("div", null,
        createElement(Ctx.Provider, { value: "hello" }, createElement(Child, null)),
        createElement(Child, null)
      ));
    `);
    await h.sandbox.start();

    const root = h.renders[0].tree[0] as any;
    expect(root.c[0].c[0].x).toBe("hello"); // inside provider
    expect(root.c[1].c[0].x).toBe("default"); // outside provider
    h.sandbox.dispose();
  });

  test("useId returns stable, per-instance ids", async () => {
    const h = harness(`
      function Field() {
        const id = useId();
        return createElement("label", { htmlFor: id }, id);
      }
      render(createElement("div", null,
        createElement(Field, null),
        createElement(Field, null)
      ));
    `);
    await h.sandbox.start();

    const root = h.renders[0].tree[0] as any;
    const a = root.c[0].p.htmlFor;
    const b = root.c[1].p.htmlFor;
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b); // distinct component instances -> distinct ids
    expect(root.c[0].c[0].x).toBe(a); // and it's stable within the render
    h.sandbox.dispose();
  });

  test("ErrorBoundary renders fallback when a child throws", async () => {
    const h = harness(`
      function Boom() { throw new Error("kaboom"); }
      function Ok() { return createElement("span", null, "ok"); }
      render(createElement("div", null,
        createElement(ErrorBoundary, { fallback: createElement("span", null, "caught") },
          createElement(Boom, null)),
        createElement(Ok, null)
      ));
    `);
    await h.sandbox.start();

    const root = h.renders[0].tree[0] as any;
    expect(root.c[0].c[0].x).toBe("caught"); // boundary fallback
    expect(root.c[1].c[0].x).toBe("ok"); // sibling still rendered
    h.sandbox.dispose();
  });

  test("ErrorBoundary fallback can be a function of the error", async () => {
    const h = harness(`
      function Boom() { throw new Error("nope"); }
      render(createElement(ErrorBoundary,
        { fallback: (e) => createElement("span", null, "err:" + e.message) },
        createElement(Boom, null)));
    `);
    await h.sandbox.start();
    expect((h.renders[0].tree[0] as any).c[0].x).toBe("err:nope");
    h.sandbox.dispose();
  });

  test("memo skips re-rendering when props are unchanged", async () => {
    let childRenders = 0;
    const h = harness(
      `
        const Child = memo(function (p) {
          host.rendered();
          return createElement("span", null, "label:" + p.label);
        });
        function App() {
          const [n, setN] = useState(0);
          return createElement("div", { onClick: () => setN(n + 1) },
            createElement("span", null, "n:" + n),
            createElement(Child, { label: "fixed" })
          );
        }
        render(createElement(App, null));
      `,
      { exposed: { host: { rendered: () => { childRenders++; } } } }
    );
    await h.sandbox.start();
    expect(childRenders).toBe(1);
    expect((h.renders[0].tree[0] as any).c[1].c[0].x).toBe("label:fixed");

    // Bump App's state; Child's props are unchanged so its body must not re-run.
    h.dispatchEvent(1, "click", {});
    await tick();
    expect((h.last()!.tree[0] as any).c[0].c[0].x).toBe("n:1");
    expect((h.last()!.tree[0] as any).c[1].c[0].x).toBe("label:fixed");
    expect(childRenders).toBe(1); // memo bailed: body not re-run
    h.sandbox.dispose();
  });

  test("Suspense shows fallback then content when a thenable settles", async () => {
    let resolve!: (v: string) => void;
    const ready = new Promise<string>((r) => {
      resolve = r;
    });
    const h = harness(
      `
        let done = false, value;
        host.ready.then((v) => { value = v; done = true; });
        function Async() {
          if (!done) throw host.ready;
          return createElement("span", null, value);
        }
        render(createElement(Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(Async, null)));
      `,
      { exposed: { host: { ready } } }
    );
    await h.sandbox.start();
    expect((h.renders[0].tree[0] as any).c[0].x).toBe("loading");

    resolve("done");
    await tick();
    h.sandbox.requestEventLoop();
    await tick();

    expect((h.last()!.tree[0] as any).c[0].x).toBe("done");
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
