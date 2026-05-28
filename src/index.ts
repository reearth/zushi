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
  type VNode,
  type SNode,
  type SEvent,
  type RenderPayload,
  type EventPayload,
  type SerializedEvent
} from "./jsx";
