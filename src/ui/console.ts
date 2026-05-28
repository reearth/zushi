export type PluginConsole = {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  info: (...args: any[]) => void;
};

/**
 * A console-like object safe to expose into the VM. Wraps the host console so
 * no host object reference crosses the boundary.
 */
export function createConsole(): PluginConsole {
  return {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
    warn: (...args) => console.warn(...args),
    info: (...args) => console.info(...args)
  };
}
