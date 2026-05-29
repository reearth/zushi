import { JsxExample } from "./jsxExample";
import { KonvaExample } from "./konvaExample";
import { ReactExample } from "./reactExample";
import { SyncedExample } from "./syncedExample";
import { VanillaExample } from "./vanillaExample";

export function App() {
  return (
    <main>
      <h1>@reearth/zushi examples</h1>
      <p>
        Click <strong>+1</strong> inside each sandboxed iframe. The click is sent
        to the plugin VM, which calls the host API and posts the new count back
        into the iframe. The last card swaps in a host-direct react-konva
        renderer — same JSX pipeline, drawn to a &lt;canvas&gt; instead of DOM.
      </p>
      <div className="grid">
        <ReactExample />
        <VanillaExample />
        <JsxExample />
        <SyncedExample />
        <KonvaExample />
      </div>
    </main>
  );
}
