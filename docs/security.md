# Security model

zushi isolates untrusted plugin code in two layers, and the guiding invariant is:
**only data crosses the boundaries; code and live references do not.**

## VM isolation (plugin logic)

- Plugin code runs in the [backend](./backends.md) VM (QuickJS by default) and
  cannot reach host globals — no `window`, `document`, `fetch`, `process`, …
  The `Function` constructor inside the VM yields the VM's global, not the host's.
- Only values allowed by `defaultIsMarshalable` (primitives, plain objects,
  arrays, plain functions, `Date`, `Promise`) cross by reference. Everything
  else is deep-cloned **by value as JSON** — so class instances lose their
  prototype, methods, and live reference at the boundary. See
  [marshaling](./backends.md#marshaling).
- Prototype pollution inside the VM does not affect the host realm.

## iframe isolation (plugin UI)

- UI iframes use `sandbox="allow-scripts allow-downloads allow-popups"` — **no
  `allow-same-origin`**, so the iframe is an opaque origin: it can't reach the
  host DOM, cookies, or same-origin resources.
- Communication is `postMessage` only; incoming messages are verified by
  `event.source`.
- The JSX layer never sends plugin handler functions to the iframe — handlers
  stay in the VM, referenced by id, and only a curated
  [`SerializedEvent`](./jsx/overview.md#how-it-works-and-why-its-safe) subset
  comes back.

## Renderer contracts

- The default [`domRenderer`](./jsx/renderers.md) keeps plugin UI in the iframe.
- A **host-direct** [`HostRenderer`](./jsx/renderers.md#why-host-direct-is-safe-for-canvas)
  gives up the iframe layer, so it is only safe for targets that never turn the
  plugin's data into execution (canvas/WebGL): no `eval` / `innerHTML` /
  DOM-building / url sinks. The component map you supply is the contract.
- The opt-in [JSX runtime](./jsx/components.md) seals `registerComponent` from
  plugin code by default, so plugins can't grant themselves the
  intrinsic-tag privilege; the `__zushi` bridge is deleted from VM globals after
  `setup`.

## Tests

The escape tests in [`src/security.test.ts`](../src/security.test.ts) pin these
properties: unreachable host globals, the `Function`-constructor escape, prototype
pollution containment, and class instances crossing only as detached JSON clones.
