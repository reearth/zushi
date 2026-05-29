# Backends

Plugin code runs inside a pluggable **backend** — the language VM. You choose
one explicitly via the required `backend` option; `quickjs()` (a QuickJS WASM
JavaScript VM) is built in. Other guest runtimes (e.g. a Python WASM VM) can
implement the same `Backend` interface and drop in here.

```ts
import { Plugin, quickjs } from "@reearth/zushi";

const plugin = new Plugin({
  backend: quickjs(),
  surfaces,
  code
});
```

## QuickJS options

Backend-specific options live on the `quickjs()` factory, not on `Plugin`:

```ts
backend: quickjs({
  module,            // a QuickJS WASM module/variant (see below)
  isMarshalable      // marshaling verdict for otherwise-rejected values
})
```

### Choosing a QuickJS variant (browsers/bundlers)

By default the VM loads via `getQuickJS()`, which fetches a separate `.wasm`
file. In a bundler/browser it's often easier to use a **singlefile** variant
that embeds the wasm, avoiding a separate fetch — pass it as `module`:

```ts
import { Plugin, quickjs } from "@reearth/zushi";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";

const module = newQuickJSWASMModuleFromVariant(variant);

new Plugin({ backend: quickjs({ module }), surfaces, code });
```

One module instance can be shared across many plugins; each plugin still gets
its own isolated VM context.

## Marshaling

Marshaling decides which host values may cross into the VM and how. QuickJS uses
[`quickjs-emscripten-sync`](https://github.com/reearth/quickjs-emscripten-sync).

**`defaultIsMarshalable`** (exported) is the baseline rule: primitives, plain
objects, arrays, plain functions, `Date`, and `Promise` are allowed to cross by
**reference** (live proxy). Everything else — notably **class instances** — is
rejected by the default rule.

**`isMarshalable`** decides what happens to rejected values, OR'd with the
default:

- `"json"` *(default)* — deep-clone the value **by value as JSON**. The plugin
  gets a detached snapshot: enumerable data crosses, but the prototype, methods,
  and live reference do **not**. This is the security boundary for host objects.
- `true` — marshal as a live proxy anyway.
- `false` — don't marshal it at all (the plugin sees `undefined`).
- `(obj) => boolean | "json"` — decide per value.

```ts
// A class instance handed to the plugin crosses as a value-only clone:
class Secret { token = "s3cr3t"; reveal() { return this.token; } }
backend: quickjs(); // default "json"
// plugin sees { token: "s3cr3t" } — no reveal(), no prototype, no live ref.
```

See the [security model](./security.md) for why this matters and the escape
tests that pin it.

## The `Backend` interface

A backend is anything implementing this contract — `Sandbox` drives it and owns
all the backend-agnostic concerns (source fetching, messages, the job loop,
error handling):

```ts
interface Backend {
  readonly name: string;                 // diagnostic label, e.g. "quickjs"
  readonly language: "js" | "python" | (string & {}); // gates language features
  init(): Promise<void>;                 // create the VM (once)
  expose(api: Record<string, any>): void; // marshal a host API in
  eval(code: string): void;              // evaluate guest source
  pump(): boolean;                       // drain one job-loop turn; more pending?
  dispose(): void;
}
```

- `language` gates language-specific host features. The opt-in
  [JSX runtime](./jsx/overview.md) is JS source, so it requires `language === "js"`;
  `Plugin` throws if you pair `jsx: true` with a non-JS backend.
- `quickjs()` returns a `BackendFactory` (`() => Backend`); `Plugin`/`Sandbox`
  accept a backend or a factory and resolve it with `resolveBackend`.

`QuickJSBackend` also exposes `arena` and `context` getters after `init()` — an
advanced escape hatch to the live `quickjs-emscripten-sync` arena / QuickJS
context.

## The low-level `Sandbox`

`Plugin` wraps `Sandbox`, the backend-agnostic host. Use `Sandbox` directly when
you don't need UI surfaces (headless plugins, custom UI wiring):

```ts
import { Sandbox, quickjs } from "@reearth/zushi";

const sandbox = new Sandbox({
  backend: quickjs(),
  code: `host.report(1 + 2);`,
  exposed: { host: { report: (v: number) => console.log(v) } }
});
await sandbox.start();
// sandbox.handleMessage(...), sandbox.requestEventLoop(), sandbox.dispose()
// sandbox.backend() → the live Backend (escape hatch)
```

`SandboxOptions`: `code` | `src`, `backend`, `exposed`, `bootstrap` (trusted
source evaluated before the plugin — used by the JSX layer), and the
[lifecycle callbacks](./concepts.md#lifecycle-callbacks).

The `exposed` factory receives a `SandboxBridge` (`messages`, `startEventLoop`);
`Plugin` extends this with `surfaces` and `runtime` — see
[Exposing a host API](./exposing-api.md).
