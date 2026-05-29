# Runtime API placement

The host controls exactly how the runtime API (`useState`, `h`, `render`, …) is
planted into plugin scope — there are **no fixed bare globals**. Three ways, from
defaults to full control.

## 1. Default namespace

By default the API lands in a `zushi` namespace object:

```ts
new Plugin({ jsx: true, /* … */ });
// plugin code:
//   const { useState, render } = zushi;
```

Change the name, or use bare globals, with `namespace`:

```ts
new Plugin({ jsx: true, namespace: "reearth" }); // reearth.useState, …
new Plugin({ jsx: true, namespace: false });     // bare: useState, render, …
```

## 2. `runtime` refs (per-name placement)

The `exposed` factory receives `runtime` — opaque ref tokens you can drop
**anywhere** in your exposed tree, alongside real host values:

```ts
new Plugin({
  jsx: true,
  exposed: ({ surfaces, runtime }) => ({
    reearth: {
      ui: surfaces.ui.api,          // host value (marshaled)
      useState: runtime.useState,   // runtime ref → resolved in the VM
      render: runtime.render
    }
  })
  // plugin code: reearth.useState(…), reearth.render(…)
});
```

The tokens never cross into the VM: zushi pulls them out of the exposed tree and
the in-VM runtime installs the **real** functions at those paths, sitting right
next to your marshaled host values. **Placing any `runtime` ref turns off the
default `namespace` placement** — you own the layout.

## 3. The `setup` slot (manual wiring)

`setup` is a trusted JS source evaluated in the VM **after** the JSX runtime and
**before** the plugin. The full runtime is in scope there as **bare names** —
including `registerComponent` — regardless of where it was placed for plugin
code, because setup runs inside `with (__zushi.runtime)`. The same bundle is
also reachable explicitly as `__zushi.runtime`.

```ts
new Plugin({
  jsx: true,
  namespace: false,                 // don't auto-plant anything
  setup: `
    // Full runtime in scope as bare names (and as __zushi.runtime).
    globalThis.widget = { useState, h, render, AutoLayout: View };
  `
});
```

`setup` is also where you register [trusted components](./components.md).

## The `__zushi` bridge (sealed by default)

When `jsx: true`, a host bridge `__zushi` (render routing + config + the runtime
bundle) is exposed into the VM. **After `setup` runs it is deleted** from the VM
globals, so plugin code can't reach the host internals. The runtime functions
keep working — they captured the bridge in a closure. Pass `exposeBridge: true`
to keep `__zushi` reachable from plugin code.

## Internal globals

Two internal globals are always present and placement-independent, so the
automatic JSX runtime and explicit imports work no matter where you placed the
API (and survive the `__zushi` deletion):

- `__zushi_jsx` — backs the automatic runtime (`jsxImportSource`).
- `__zushi_api` — the sealed runtime bundle for explicit imports
  (`@reearth/zushi/jsx`, `react-compat`). Sealed = excludes `registerComponent`
  unless `exposeRegisterComponent` is set.
