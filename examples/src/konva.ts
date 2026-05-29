import { hostReactRenderer } from "@reearth/zushi";
import React from "react";
import { createRoot } from "react-dom/client";
import { Stage, Layer, Rect, Circle, Text, Group } from "react-konva";
// Register the konva shape nodes we use. With a bundler (Vite) react-konva and
// konva are one deduped instance, so these register on the very konva
// react-konva draws with — no iframe, no CDN, no instance juggling.
import "konva/lib/shapes/Rect";
import "konva/lib/shapes/Circle";
import "konva/lib/shapes/Text";

// A host-direct canvas renderer: react-konva draws straight into the surface's
// container in the host page (no iframe). Safe because the plugin only sends a
// data tree across the VM boundary, and these canvas components never turn that
// data into code/markup (no eval / innerHTML / DOM nodes) — see HostRenderer.
export const konvaRenderer = hostReactRenderer({
  name: "konva",
  React,
  createRoot,
  components: { Stage, Layer, Rect, Circle, Text, Group },
  // Konva wraps the DOM event in `evt`; expose the stage pointer position.
  serializeEvent: (e: any) => {
    const stage = e?.target?.getStage?.();
    const pos = stage?.getPointerPosition?.();
    return pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : {};
  }
});

// The plugin "draws" on the canvas with intrinsic tags (strings) that the konva
// renderer maps to react-konva components. Hooks come from the `zushi`
// namespace; the tag vocabulary is gated by the host's `intrinsics` allowlist.
export const konvaPluginSource = `
  const { useState, h, render } = zushi;

  function App() {
    const [boxes, setBoxes] = useState([]);

    function addBox(x, y) {
      const colors = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7"];
      setBoxes([...boxes, {
        id: Date.now(),
        x: x - 20, y: y - 20,
        fill: colors[boxes.length % colors.length]
      }]);
      host.event("add", boxes.length + 1);
    }

    return h("Stage", { width: 320, height: 220, onClick: (e) => addBox(e.x, e.y) },
      h("Layer", null,
        h("Rect", { x: 0, y: 0, width: 320, height: 220, fill: "#0f172a" }),
        h("Text", {
          x: 12, y: 12, text: "click to add a box (" + boxes.length + ")",
          fontSize: 14, fill: "#94a3b8"
        }),
        ...boxes.map((b) =>
          h("Rect", {
            key: b.id, x: b.x, y: b.y, width: 40, height: 40,
            fill: b.fill, cornerRadius: 6, draggable: true
          })
        )
      )
    );
  }

  render(h(App));
`;
