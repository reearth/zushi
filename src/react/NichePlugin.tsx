import { type CSSProperties } from "react";

import { usePlugin, type UsePluginOptions } from "./usePlugin";

export type NichePluginProps = UsePluginOptions & {
  className?: string;
  style?: CSSProperties;
};

/**
 * Renders a container element and runs a niche Plugin inside it. The plugin's
 * main UI iframe mounts into this element.
 */
export function NichePlugin({ className, style, ...options }: NichePluginProps) {
  const { containerRef } = usePlugin<HTMLDivElement>(options);
  return <div ref={containerRef} className={className} style={style} />;
}
