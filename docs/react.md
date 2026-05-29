# React adapter

`@reearth/zushi/react` ties a plugin to a React component's lifecycle. `react`
is an optional peer dependency.

## `PluginView`

`PluginView` mounts one element and hosts a surface named `"ui"` in it (rename
via the `surface` prop; declare extra off-screen surfaces via `surfaces`). It
takes the same options as `Plugin` plus a few view props (`surface`,
`autoResize`, `className`, `style`, …).

```tsx
import { PluginView } from "@reearth/zushi/react";
import { quickjs } from "@reearth/zushi";

function MyPlugin() {
  return (
    <PluginView
      backend={quickjs()}
      code={pluginSource}
      style={{ width: 320, height: 240 }}
      exposed={({ surfaces }) => ({ reearth: { ui: surfaces.ui.api } })}
    />
  );
}
```

## `usePlugin`

The hook directly, when you want to own the element:

```tsx
import { usePlugin } from "@reearth/zushi/react";
import { quickjs } from "@reearth/zushi";

function MyPlugin() {
  const { containerRef, getPlugin } = usePlugin({
    backend: quickjs(),
    code: pluginSource
  });
  return <div ref={containerRef} />;
}
```

`usePlugin` (re)initializes the VM when `code`/`src` change and disposes on
unmount; other options are read via a ref so they don't force a re-init.
`getPlugin()` returns the live `Plugin` (e.g. to call `handleMessage`).

## `useEmit`

`useEmit` helps push host→plugin messages with stable identity semantics tied to
the function-fingerprint machinery (see
[Storage & events](./storage-and-events.md#function-fingerprints)).

## React-library compatibility (experimental)

The in-VM JSX runtime is React-*like*, not React. Third-party libraries that
import from `"react"` won't bind to it by default. As a best-effort escape
hatch, alias your bundler's `"react"` to `@reearth/zushi/react-compat` (and set
`jsxImportSource` to `"@reearth/zushi"`); *headless* libraries that only use
hooks and elements may then run inside the VM. Anything touching `react-dom`,
real DOM refs, portals, or concurrent features will not work — treat this as a
subset, not full compatibility.
