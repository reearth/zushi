# Storage & events

## `ClientStorage`

A per-instance key-value store backed by IndexedDB (via `localforage`). Useful
for giving plugins durable storage scoped to a plugin instance — expose its
methods through your [`exposed`](./exposing-api.md) API.

```ts
import { ClientStorage } from "@reearth/zushi";

const storage = new ClientStorage(/* { storeName? } */);

await storage.setAsync(instanceId, "key", { count: 1 });
await storage.getAsync(instanceId, "key");   // → { count: 1 }
await storage.keysAsync(instanceId);         // → ["key"]
await storage.deleteAsync(instanceId, "key");
await storage.dropStore(instanceId);         // wipe an instance's store
```

`instanceId` namespaces entries, so one `ClientStorage` can serve many plugin
instances without collisions. The backing store name defaults to
`zushi-plugin-${instanceId}`.

`ClientStorage` is also the persistence backing for
[synced state](./jsx/synced.md) (`useSyncedState` with `persist: true`).

## The event emitter

`events<E>()` creates a typed event emitter, returning a `[listener, emit]`
pair. zushi uses it internally (e.g. for surface events); it's exported for your
own typed channels.

```ts
import { events } from "@reearth/zushi";

const [on, emit] = events<{ change: [value: number] }>();
on.on("change", (v) => console.log(v));
emit("change", 42);
// on.off(...), on.once(...)
```

## Function fingerprints

Event listeners pose a subtle problem across the VM boundary: a plugin function
marshaled to the host and back may not be **reference-equal** to the original,
so a naive `off(fn)` wouldn't find the listener to remove.

zushi solves this with **function fingerprints** — a stable identity derived
from a function's name, length, and source. The fingerprint helpers are exported
for advanced use:

- `getFunctionFingerprint(fn)` — structured fingerprint.
- `getFunctionFingerprintString(fn)` — a string hash usable as a `Map` key.
- `areFunctionsSame(a, b)` — compare two functions by fingerprint.

This is what lets `messages.off(...)` and the [React `useEmit`](./react.md#useemit)
helper match the right listener even after marshaling round-trips.
