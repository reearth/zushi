import { type CSSProperties } from "react";

import { usePlugin, type UsePluginOptions } from "./usePlugin";

export type PluginViewProps = UsePluginOptions & {
  className?: string;
  style?: CSSProperties;
};

/**
 * Renders a container element and runs a zushi Plugin inside it. The plugin's
 * main UI iframe mounts into this element.
 */
export function PluginView({ className, style, ...options }: PluginViewProps) {
  const { containerRef } = usePlugin<HTMLDivElement>(options);
  return <div ref={containerRef} className={className} style={style} />;
}
