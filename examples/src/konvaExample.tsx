import { type PluginContext } from "@reearth/zushi";
import { PluginView } from "@reearth/zushi/react";
import { useCallback, useRef } from "react";

import { konvaRenderer, konvaPluginSource } from "./konva";
import { backend, Log, useHostLog } from "./shared";

// Host-direct renderer: the same JSX pipeline, but react-konva draws straight to
// a <canvas> in the host page (no iframe). The plugin emits a Stage/Layer/Rect
// intrinsic tree; the konva renderer commits it to canvas.
export function KonvaExample() {
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
      <h2>Canvas · react-konva renderer</h2>
      <PluginView
        jsx
        renderer={konvaRenderer}
        intrinsics={["Stage", "Layer", "Rect", "Circle", "Text", "Group"]}
        code={konvaPluginSource}
        backend={backend}
        exposed={exposed}
        className="frame"
      />
      <Log entries={log} />
    </section>
  );
}
