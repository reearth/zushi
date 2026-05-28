export const insertToBody = (
  html: string | undefined,
  insertStr: string
): string => {
  if (html === undefined) return "";
  let lastBodyIndex = html.lastIndexOf("</body>");
  if (lastBodyIndex < 0) lastBodyIndex = html.lastIndexOf("</BODY>");
  return lastBodyIndex < 0
    ? `${html}${insertStr}`
    : `${html.substring(0, lastBodyIndex)}${insertStr}${html.substring(lastBodyIndex)}`;
};

export const autoResizeScript = (autoResizeMessageKey: string): string => {
  return `<script id="_niche_resize">
      if ("ResizeObserver" in window) {
        new window.ResizeObserver(entries => {
          const win = document.defaultView;
          const html = document.body.parentElement;
          const st = win.getComputedStyle(html, "");
          const horizontalMargin = parseInt(st.getPropertyValue("margin-left"), 10) + parseInt(st.getPropertyValue("margin-right"), 10);
          const verticalMargin = parseInt(st.getPropertyValue("margin-top"), 10) + parseInt(st.getPropertyValue("margin-bottom"), 10);
          const width = html.offsetWidth + horizontalMargin;
          const height = html.offsetHeight + verticalMargin;
          if (parent) {
            parent.postMessage({
              [${JSON.stringify(autoResizeMessageKey)}]: { width, height }
            }, "*");
          }
        }).observe(document.body.parentElement);
      }
    </script>`;
};

const toPx = (v: number | string | undefined): string | undefined =>
  typeof v === "number" ? `${v}px` : (v ?? undefined);

export const sizeToPx = (
  width: number | string | undefined,
  height: number | string | undefined
): [string | undefined, string | undefined] | undefined => {
  const w = toPx(width);
  const h = toPx(height);
  return w || h ? [w, h] : undefined;
};
