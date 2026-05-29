export const version = "0.0.0";

export * from "./events";
export * from "./iframe";
export * from "./runtime";
export * from "./storage";
export * from "./ui";
export { merge } from "./utils/merge";
export {
  Plugin,
  type PluginOptions,
  type PluginContext,
  type SurfaceConfig
} from "./plugin";
export {
  domRenderer,
  reactRenderer,
  hostReactRenderer,
  isHostRenderer,
  ROOT_ID,
  MSG_RENDER,
  MSG_EVENT,
  type Renderer,
  type HostRenderer,
  type HostRendererInstance,
  type HostRenderContext,
  type AnyRenderer,
  type ReactRendererOptions,
  type HostReactRendererOptions,
  type VNode,
  type SNode,
  type SEvent,
  type RenderPayload,
  type EventPayload,
  type SerializedEvent
} from "./jsx";
