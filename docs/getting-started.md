# Getting started

## Install

```sh
npm install @reearth/zushi
```

`react` is an optional peer dependency, only needed for the [React adapter](./react.md).

## Quick start

```ts
import { Plugin, quickjs } from "@reearth/zushi";

const plugin = new Plugin({
  // Choose the execution backend explicitly. `quickjs()` runs plugin code in a
  // QuickJS (WASM) JavaScript VM.
  backend: quickjs(),
  // Declare the UI surfaces you want. None are created by default; each gets a
  // sandboxed iframe. Omit `container` for off-screen surfaces (e.g. a modal).
  surfaces: {
    main: { container: document.getElementById("plugin-ui")! },
    dialog: {}
  },
  code: `
    // This runs inside the QuickJS VM. It has no DOM access.
    reearth.ui.show("<h1>Hello from a plugin</h1>");
    reearth.ui.on("message", (msg) => reearth.console.log("from iframe:", msg));
    host.greet("world");
  `,
  // Build the API exposed to plugin code. Only \`console\` is provided by
  // default; you wire surfaces up under whatever names you like.
  exposed: ({ surfaces, messages, startEventLoop }) => ({
    reearth: {
      ui: surfaces.main.api,
      modal: surfaces.dialog.api,
      messages,
      startEventLoop
    },
    host: {
      greet: (name: string) => console.log(`plugin greeted ${name}`)
    }
  })
});

await plugin.start();
// ...later
plugin.dispose();
```

## Mental model

- **`code` (or `src`)** is untrusted plugin source. It runs in the backend VM,
  not the host page — no `window`, `document`, or `fetch` unless you hand them over.
- **`backend`** is the VM. It's required and chosen explicitly; `quickjs()` is
  built in. See [Backends](./backends.md).
- **`surfaces`** are named UI regions. Each is a sandboxed iframe the plugin can
  render HTML into (or draw to via the [JSX runtime](./jsx/overview.md)). See
  [Surfaces & iframes](./surfaces.md).
- **`exposed`** is a factory returning the global object tree the plugin sees.
  Only a `console` is provided by default; you decide everything else and under
  what names. See [Exposing a host API](./exposing-api.md).
- **`plugin.start()`** initializes the VM, exposes the API, and runs the code.
  **`plugin.dispose()`** tears everything down.

For a declarative, component-based UI instead of HTML strings, opt into the
[JSX runtime](./jsx/overview.md) with `jsx: true`.

Using React in your host app? The [React adapter](./react.md) (`PluginView` /
`usePlugin`) ties a plugin to a component's lifecycle.
