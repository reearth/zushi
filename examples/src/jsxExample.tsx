import { type PluginContext } from "@reearth/zushi";
import { PluginView } from "@reearth/zushi/react";
import { useCallback, useRef } from "react";

import { jsxSetup, jsxPluginSource } from "./jsxPluginSource";
import { backend, Log, useHostLog } from "./shared";

// Opt-in JSX runtime: the plugin builds UI declaratively with hooks, confined to
// host-registered components (intrinsics disabled).
export function JsxExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;

  const exposed = useCallback(
    (_ctx: PluginContext) => ({
      host: {
        event: (name: string, value?: number) =>
          hostRef.current.event(name, value)
      }
    }),
    []
  );

  return (
    <section className="card">
      <h2>JSX · render(&lt;App/&gt;)</h2>
      <PluginView
        jsx
        setup={jsxSetup}
        intrinsics={false}
        code={jsxPluginSource}
        backend={backend}
        autoResize="both"
        exposed={exposed}
        className="frame"
      />
      <Log entries={log} />
    </section>
  );
}
