import { useEffect, useRef } from "react";

import { Plugin, type PluginOptions } from "../plugin";

export type UsePluginOptions = Omit<
  PluginOptions,
  "container" | "modalContainer" | "popupContainer"
>;

export type UsePluginResult<T extends HTMLElement = HTMLDivElement> = {
  /** Attach this ref to the element the main UI should mount into. */
  containerRef: React.RefObject<T>;
  /** Imperatively access the live Plugin instance (e.g. to post messages). */
  getPlugin: () => Plugin | undefined;
};

/**
 * Runs a niche Plugin tied to a React element's lifecycle. The VM is
 * (re)initialized when `code` or `src` changes and disposed on unmount.
 */
export function usePlugin<T extends HTMLElement = HTMLDivElement>(
  options: UsePluginOptions
): UsePluginResult<T> {
  const containerRef = useRef<T>(null);
  const pluginRef = useRef<Plugin>();

  // Keep the latest options without forcing VM re-init on every render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const plugin = new Plugin({ ...optionsRef.current, container });
    pluginRef.current = plugin;
    plugin.start().catch((err) => optionsRef.current.onError?.(err));

    return () => {
      plugin.dispose();
      pluginRef.current = undefined;
    };
    // Re-create only when the source changes; other options are read via ref.
  }, [options.code, options.src]);

  return {
    containerRef,
    getPlugin: () => pluginRef.current
  };
}
