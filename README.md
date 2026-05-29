# zushi

A framework-agnostic plugin runtime for the browser. Run untrusted plugin code
in an isolated WASM **backend** — a built-in [QuickJS](https://github.com/justjake/quickjs-emscripten)
backend runs JavaScript, with room for other guest languages — expose a
host-defined API into it, and render plugin UI inside sandboxed `<iframe>`s (or,
opt-in, on a host `<canvas>`).

> The name comes from _zushi_ (厨子), a small Japanese cabinet that enshrines a precious object behind doors you open only when needed — much like a host that encloses an external module and opens it to render on demand.

## Why

Running third-party plugin code safely in a web app needs two layers of
isolation, and zushi packages both plus the wiring between them:

1. **A language VM** behind a pluggable `Backend` (QuickJS for JavaScript by
   default) — plugin logic never touches the host realm (no `window`,
   `document`, `fetch`) unless you hand it over.
2. **Sandboxed iframes** for plugin UI — opaque origin, `postMessage`-only.

Only **data** crosses these boundaries; code and live references do not.

## Install

```sh
npm install @reearth/zushi
```

## Quick start

```ts
import { Plugin, quickjs } from "@reearth/zushi";

const plugin = new Plugin({
  backend: quickjs(), // the execution backend (QuickJS WASM VM)
  surfaces: { main: { container: document.getElementById("plugin-ui")! } },
  code: `
    // Runs inside the VM — no DOM access.
    reearth.ui.show("<h1>Hello from a plugin</h1>");
    host.greet("world");
  `,
  // Build the globals the plugin sees (only \`console\` is provided by default).
  exposed: ({ surfaces }) => ({
    reearth: { ui: surfaces.main.api },
    host: { greet: (name: string) => console.log(`plugin greeted ${name}`) }
  })
});

await plugin.start();
// ...later
plugin.dispose();
```

Using React? `PluginView` / `usePlugin` (`@reearth/zushi/react`) tie a plugin to
a component's lifecycle. Want declarative, component-based UI instead of HTML
strings? Opt into the JSX runtime with `jsx: true`. Drawing to a canvas? Swap in
a host-direct renderer (e.g. react-konva). All covered in the docs below.

## Documentation

Full docs live in [`docs/`](./docs):

- **[Getting started](./docs/getting-started.md)** · [Concepts](./docs/concepts.md) (architecture, event loop, messaging, lifecycle)
- **Core** — [Backends](./docs/backends.md) · [Surfaces & iframes](./docs/surfaces.md) · [Exposing a host API](./docs/exposing-api.md)
- **JSX UI (opt-in)** — [Overview](./docs/jsx/overview.md) · [Runtime API placement](./docs/jsx/placement.md) · [Components & intrinsics](./docs/jsx/components.md) · [Renderers (canvas, etc.)](./docs/jsx/renderers.md)
- **Integration** — [React adapter](./docs/react.md) · [Storage & events](./docs/storage-and-events.md) · [Security model](./docs/security.md)

Exact option/type signatures are documented inline via TSDoc and shipped as
`.d.ts` — let your editor's hover/autocomplete be the reference.

## Examples

```sh
pnpm example   # Vite dev server: React, vanilla, JSX runtime, and a canvas renderer
```

See [`examples/`](./examples) — one file per case. The vanilla example's plugin
source is also driven by a real-browser regression test
([`examples/regression.browser.test.ts`](./examples/regression.browser.test.ts)),
so it doubles as an end-to-end check of the whole pipeline.

## Testing

- `pnpm test` — unit/logic tests in jsdom (VM behavior is real QuickJS; iframe DOM stubbed).
- `pnpm test:browser` — real-browser tests (Vitest browser mode / Playwright Chromium): real `srcdoc`, injected scripts, `postMessage`, `ResizeObserver` auto-resize, sandbox isolation, and the examples end-to-end. Run `npx playwright install chromium` once.
- `pnpm test:all` — both.

## License

MIT
