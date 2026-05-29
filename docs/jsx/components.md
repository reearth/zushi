# Components & restricting HTML

The host can register trusted custom components (à la Figma's `View`/`Text`) and
optionally forbid raw HTML in plugin code, confining plugins to a curated
component vocabulary.

```ts
new Plugin({
  backend: quickjs(),
  jsx: true,
  surfaces: { ui: { container } },
  intrinsics: false, // plugins may not use raw HTML tags…
  setup: `
    // …but trusted components, run in the VM before the plugin, may.
    registerComponent("View", (p) =>
      h("div", { style: { display: "flex", gap: p.gap, ...p.style } }, p.children));
    registerComponent("Text", (p) => h("span", { style: p.style }, p.children));
  `,
  code: `
    const { h, render } = zushi;     // registered View/Text are bare globals
    render(h(View, { gap: 8 }, h(Text, null, "hello")));
  `
});
```

## `intrinsics` policy

Gates plugin-authored intrinsic (HTML/renderer) tags:

- `true` *(default)* — any tag allowed.
- `false` — none; plugins must render through registered components.
- `string[]` — an allowlist of tag names (e.g. `["Stage", "Layer", "Rect"]` for
  a [canvas renderer](./renderers.md)).

Tags emitted **inside a registered component** are always allowed, regardless of
policy — the runtime tracks trust depth, so a trusted component can emit `div`
even when plugin code can't. This is what makes a curated vocabulary work:
plugins compose `View`/`Text`, the components emit the real intrinsics.

## `registerComponent` and sealing

`registerComponent(name, fn)` registers a trusted component and exposes it as a
bare global by name (so plugin code uses `<View>` / `h(View, …)` directly,
independent of where the runtime API is placed).

By default `registerComponent` is **sealed from plugin code**: it's only in
scope inside the trusted [`setup`](./placement.md#3-the-setup-slot-manual-wiring)
slot (and absent from the default placement and the explicit-import bundle). So
plugin code can't register components — and therefore can't grant itself the
intrinsic-tag privilege. Set `exposeRegisterComponent: true` to include it in
the placement for plugin code too.
