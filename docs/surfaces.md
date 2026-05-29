# Surfaces & iframes

A **surface** is a named UI region the plugin can render into, backed by a
sandboxed iframe. None are created by default — declare exactly the ones you
need:

```ts
new Plugin({
  backend: quickjs(),
  surfaces: {
    main: { container: document.getElementById("ui")! },
    dialog: {}          // no container → a hidden off-screen surface
  },
  // ...
});
```

`SurfaceConfig` per surface:

- `container?` — the element the iframe mounts into. **Omit it** and zushi
  creates a hidden `<div>` in `<body>` for you (useful for modals/popups that
  the plugin will position or reveal later). Owned hidden containers are removed
  on `dispose()`.
- `autoResize?` — `"both"` | `"width-only"` | `"height-only"`; see below.
- `visible?` — initial visibility (default `true`).

Surfaces are handed to the `exposed` factory as `surfaces` (keyed by name); the
host wires them into the plugin API under whatever names it likes — they are not
auto-exposed. See [Exposing a host API](./exposing-api.md).

## `UISurface` and `SurfaceAPI`

Each surface is a `UISurface`. The method surface a host typically exposes to
plugins is `surface.api` (a `SurfaceAPI`):

- `show(html, { visible?, width?, height? })` — render an HTML document into the
  iframe.
- `update({ visible?, width?, height? })` — re-render with changed options.
- `resize(width?, height?)`, `close()` — size / hide (emits `"close"`).
- `postMessage(message)` — send a JSON message into the iframe.
- `on(type, cb)` / `off(type, cb)` — subscribe to surface events: `"message"`
  (a message from the iframe) and `"close"`.

`UISurface` also exposes `container`, `frame` (the underlying `SafeIFrame`), and
`events`.

## The sandbox

Iframes use `sandbox="allow-scripts allow-downloads allow-popups"` — crucially
**no `allow-same-origin`**, so the iframe is an **opaque origin**: its scripts
run, but it can't reach the host's DOM, cookies, or same-origin resources, and
the host can't read into it. Communication is `postMessage` only, and incoming
messages are verified by `event.source` (must be this iframe's window).

`postMessage` payloads are JSON-cloned before sending; non-JSON-serializable
values are dropped.

The iframe element is created **lazily** — only when `show()` (or a renderer's
first render) runs. A declared-but-never-shown surface creates no iframe. (This
is what lets a [host-direct renderer](./jsx/renderers.md) use the container
without an iframe.)

## Auto-resize

With `autoResize`, the iframe injects a `ResizeObserver` that posts its content
size to the host, which sizes the iframe element to match. The protocol message
uses a reserved key (`___iframe_auto_resize___`) and is intercepted internally —
it is **not** surfaced as a `"message"` event. Modes: `"both"`, `"width-only"`,
`"height-only"`.

## `SafeIFrame` (low-level)

`UISurface` is built on `SafeIFrame`, which you can use directly for custom iframe
needs. It manages srcdoc injection, the sandbox, auto-resize, visibility, and the
message channel:

```ts
import { SafeIFrame, DEFAULT_SANDBOX } from "@reearth/zushi";

const frame = new SafeIFrame({
  container,
  autoResize: "both",
  onMessage: (data) => console.log(data),
  // sandbox defaults to DEFAULT_SANDBOX; override only if you understand the risk
});
frame.render("<h1>hi</h1>");
```
