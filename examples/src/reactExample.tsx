import { type PluginContext } from "@reearth/zushi";
import { PluginView } from "@reearth/zushi/react";
import { useCallback, useRef } from "react";

import { pluginSource } from "./pluginSource";
import { backend, Log, useHostLog } from "./shared";

// React usage via <PluginView>.
export function ReactExample() {
  const { log, host } = useHostLog();
  const hostRef = useRef(host);
  hostRef.current = host;

  const exposed = useCallback(
    ({ surfaces }: PluginContext) => ({
      ui: surfaces.ui.api,
      host: {
        increment: (n: number) => hostRef.current.increment(n),
        event: (name: string, value?: number) => hostRef.current.event(name, value)
      }
    }),
    []
  );

  return (
    <section className="card">
      <h2>React · &lt;PluginView&gt;</h2>
      <PluginView
        code={pluginSource}
        backend={backend}
        autoResize="both"
        exposed={exposed}
        className="frame"
      />
      <Log entries={log} />
    </section>
  );
}
