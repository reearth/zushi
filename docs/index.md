# zushi documentation

A framework-agnostic plugin runtime for the browser: run untrusted plugin code
in an isolated WASM **backend** (QuickJS built in), expose a host-defined API
into it, and render plugin UI inside sandboxed `<iframe>`s — or, opt-in, on a
host `<canvas>`.

This is the full documentation. For a one-screen overview see the
[README](../README.md).

## Two layers of isolation

1. **A language VM** behind a pluggable [`Backend`](./backends.md) (QuickJS for
   JavaScript by default) — plugin logic never touches the host realm.
2. **Sandboxed iframes** for plugin UI (opaque origin, `postMessage`-only) —
   see [Surfaces & iframes](./surfaces.md).

Only **data** crosses these boundaries; code and live references do not.
See [Concepts](./concepts.md) for the full data-flow picture.

## Contents

### Getting started
- [Getting started](./getting-started.md) — install, quick start, mental model
- [Concepts](./concepts.md) — architecture, the event loop, message channel, lifecycle

### Core
- [Backends](./backends.md) — the `Backend` abstraction, `quickjs()`, marshaling, the low-level `Sandbox`
- [Surfaces & iframes](./surfaces.md) — UI surfaces, the sandbox, auto-resize, hidden containers
- [Exposing a host API](./exposing-api.md) — the `exposed` factory, the built-in `console`, messaging

### JSX UI (opt-in)
- [JSX overview](./jsx/overview.md) — the in-VM runtime, hooks, writing JSX
- [Runtime API placement](./jsx/placement.md) — namespace, `runtime` refs, the `setup` slot, bridge sealing
- [Components & intrinsics](./jsx/components.md) — `registerComponent`, trust, restricting HTML
- [Renderers](./jsx/renderers.md) — iframe vs host-direct, react-konva, the patcher contract

### Integration
- [React adapter](./react.md) — `usePlugin`, `PluginView`, `useEmit`, react-compat
- [Storage & events](./storage-and-events.md) — `ClientStorage`, the event emitter, function fingerprints
- [Security model](./security.md) — what's isolated, what crosses, renderer contracts

> API reference: every option and type is documented inline via TSDoc and shipped
> as `.d.ts` — your editor's hover/autocomplete is the source of truth for exact
> signatures. These pages explain concepts, behaviors, and usage.
