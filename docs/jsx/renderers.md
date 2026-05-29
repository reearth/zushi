# Renderers

The JSX pipeline is renderer-agnostic: the in-VM runtime reconciles components
and hooks into a serialized intrinsic tree, and a **renderer** turns that tree
into something visible. The plugin keeps writing JSX; only the renderer changes.
There are two kinds, differing in isolation:

- **iframe `Renderer`** (default `domRenderer`) — draws in a sandboxed iframe.
  Required for HTML, where untrusted markup must be isolated.
- **host-direct `HostRenderer`** — draws straight in the host page, no iframe.
  Use it only for targets that can't execute the data they're given — `<canvas>`
  / WebGL (react-konva, react-three-fiber, react-pixi, …).

## Why host-direct is safe for canvas

Plugin code never leaves the VM; only a serialized **data** tree crosses to the
host — never code or functions. So a host-direct renderer is safe **as long as
it never turns that data into execution**:

- no `eval` / `new Function`,
- no `innerHTML` / `dangerouslySetInnerHTML`,
- no DOM-building components (e.g. react-konva's `Html`),
- no routing data into `href` / `src` / `fetch`.

Canvas drawing primitives (shapes, text, transforms) clear that bar; arbitrary
HTML does not — render HTML through an iframe renderer. The component map you
hand a renderer is the contract: keep it to draw-only primitives.

## Canvas with `hostReactRenderer`

`hostReactRenderer` is the easy path for canvas: pass your app's React and a
component map directly — no iframe, no CDN, no cross-origin loading, and one
deduped konva instance, so react-konva's setup just works.

```ts
import { hostReactRenderer } from "@reearth/zushi";
import React from "react";
import { createRoot } from "react-dom/client";
import { Stage, Layer, Rect } from "react-konva";
import "konva/lib/shapes/Rect"; // register the shapes you use

const konva = hostReactRenderer({
  React,
  createRoot,
  components: { Stage, Layer, Rect },
  // optional: serializeEvent(evt, type) → payload sent to the plugin handler
});

new Plugin({
  backend: quickjs(),
  jsx: true,
  renderer: konva,
  intrinsics: ["Stage", "Layer", "Rect"], // the renderer's tag vocabulary
  surfaces: { ui: { container } },
  code: `
    const { useState, h, render } = zushi;
    render(h("Stage", { width: 320, height: 220 },
      h("Layer", null, h("Rect", { x: 20, y: 20, width: 80, height: 60, fill: "tomato" }))));
  `
});
```

The plugin emits intrinsic tags as **strings** (`"Stage"`, `"Rect"`); the
component map decides what they mean, and `intrinsics` gates which are allowed.
A full runnable example is the canvas card in
[`examples/`](../../examples/src/konvaExample.tsx) (renderer in
[`konva.ts`](../../examples/src/konva.ts)).

> Registering konva shapes (`import "konva/lib/shapes/Rect"`) only works because
> a bundler dedupes konva to one instance shared with react-konva. CDN ESM
> builds fragment konva into separate instances and the shapes never register —
> bundle these deps.

## iframe React renderer

When you do want iframe isolation for a React-driven UI, `reactRenderer` builds
a patcher that commits the tree with React inside the iframe, reading three
globals you set from its `bootstrap` script: `__zushiReact`,
`__zushiCreateRoot`, `__zushiComponents` (and optional `__zushiSerializeEvent`).
You decide how React and the components reach the iframe (bundle them and import
the bundle; a bundler dedupes konva, CDN builds don't).

## The patcher contract

To write any renderer from scratch, implement the contract the host and VM
already speak:

- **iframe `Renderer`** — provide `patcherHtml`, a full iframe document that:
  mounts into `#__zushi_root` (id is `ROOT_ID`); on each
  `{ __zushi: "render", g, tree }` message renders the full `tree` (diff however
  you like); and posts `{ __zushi: "event", hid, type, g, payload }` to the
  parent when a listener fires. `payload` is yours to define (it's handed to the
  plugin handler verbatim).
- **host-direct `HostRenderer`** — set `target: "host"` and implement
  `mount(container, { onEvent })` returning `{ render(tree, gen), resize?, dispose() }`.
  Call `onEvent(hid, type, payload, gen)` when a listener fires.

Use `isHostRenderer(r)` to distinguish the two at runtime.
