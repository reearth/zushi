export type AutoResize = "both" | "width-only" | "height-only";

export type RenderOptions = {
  visible?: boolean;
  width?: number | string;
  height?: number | string;
  onAutoResized?: () => void;
};

/**
 * The minimal surface a sandboxed iframe exposes to the runtime / plugin code.
 */
export type IFrameAPI = {
  render: (html: string, options?: RenderOptions) => void;
  resize: (
    width: string | number | undefined,
    height: string | number | undefined
  ) => void;
  postMessage: (message: any) => void;
};
