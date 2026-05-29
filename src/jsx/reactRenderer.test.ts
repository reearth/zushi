import { describe, expect, test, vi } from "vitest";

import { reactRenderer, hostReactRenderer } from "./reactRenderer";
import { ROOT_ID } from "./protocol";

describe("reactRenderer", () => {
  test("builds a Renderer whose patcher embeds bootstrap, root, and runtime", () => {
    const r = reactRenderer({
      name: "konva",
      bootstrap: `globalThis.__MY_BOOTSTRAP__ = 1;`,
      head: `<style>/*__MY_HEAD__*/</style>`
    });
    expect(r.name).toBe("konva");
    // Mounts the contracted root element.
    expect(r.patcherHtml).toContain(`id="${ROOT_ID}"`);
    // Bootstrap runs as a module; runtime as a classic script.
    expect(r.patcherHtml).toContain('<script type="module">');
    expect(r.patcherHtml).toContain("__MY_BOOTSTRAP__");
    expect(r.patcherHtml).toContain("__MY_HEAD__");
    // The runtime reads the globals the bootstrap is expected to set.
    expect(r.patcherHtml).toContain("__zushiComponents");
    expect(r.patcherHtml).toContain("__zushiCreateRoot");
  });

  test("defaults the name to react", () => {
    expect(reactRenderer({ bootstrap: "" }).name).toBe("react");
  });
});

describe("hostReactRenderer", () => {
  // A minimal fake React that records createElement calls as plain nodes.
  const fakeReact = {
    Fragment: "FRAGMENT",
    createElement: (type: any, props: any, ...children: any[]) => ({
      type,
      props,
      children
    })
  };

  test("is a host-target renderer and maps tags through the component map", () => {
    const rendered: any[] = [];
    const createRoot = () => ({
      render: (node: any) => rendered.push(node),
      unmount: () => {}
    });
    const Rect = function Rect() {};
    const r = hostReactRenderer({
      name: "konva",
      React: fakeReact,
      createRoot,
      components: { Rect }
    });
    expect(r.name).toBe("konva");
    expect(r.target).toBe("host");

    const events: any[] = [];
    const inst = r.mount(document.createElement("div"), {
      onEvent: (hid, type, payload, gen) =>
        events.push({ hid, type, payload, gen })
    });
    inst.render(
      [{ t: "Rect", p: { x: 1 }, ev: [{ t: "click", h: 7 }], c: [{ x: "hi" }] }],
      3
    );

    // Rendered a Fragment wrapping the mapped Rect component.
    const root = rendered[0];
    expect(root.type).toBe("FRAGMENT");
    const rect = root.children[0];
    expect(rect.type).toBe(Rect); // tag "Rect" → component
    expect(rect.props.x).toBe(1);
    expect(rect.children).toEqual(["hi"]); // text child
    // Event listener wired as onClick, posting through onEvent with the gen.
    expect(typeof rect.props.onClick).toBe("function");
    rect.props.onClick({});
    expect(events).toEqual([{ hid: 7, type: "click", payload: {}, gen: 3 }]);
  });

  test("dispose unmounts the root", () => {
    const unmount = vi.fn();
    const r = hostReactRenderer({
      React: fakeReact,
      createRoot: () => ({ render: () => {}, unmount }),
      components: {}
    });
    const inst = r.mount(document.createElement("div"), { onEvent: () => {} });
    inst.dispose();
    expect(unmount).toHaveBeenCalled();
  });
});
