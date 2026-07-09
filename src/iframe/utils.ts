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

/**
 * Inserts `insertStr` as early as possible inside the document head: right
 * after an opening `<head>` tag, else before `</head>`, else at the very start.
 * Used to place a CSP `<meta>` before the content it must govern.
 */
export const insertToHead = (html: string, insertStr: string): string => {
  const open = /<head[^>]*>/i.exec(html);
  if (open) {
    const at = open.index + open[0].length;
    return html.slice(0, at) + insertStr + html.slice(at);
  }
  const close = html.toLowerCase().indexOf("</head>");
  if (close >= 0) return html.slice(0, close) + insertStr + html.slice(close);
  return insertStr + html;
};

/** A CSP `<meta http-equiv>` tag for the given policy (quotes escaped). */
export const cspMeta = (policy: string): string =>
  `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, "&quot;")}">`;

export const autoResizeScript = (autoResizeMessageKey: string): string => {
  return `<script id="_zushi_resize">
      if ("ResizeObserver" in window) {
        let lastWidth, lastHeight;
        new window.ResizeObserver(entries => {
          const win = document.defaultView;
          const html = document.body.parentElement;
          const st = win.getComputedStyle(html, "");
          const horizontalMargin = parseInt(st.getPropertyValue("margin-left"), 10) + parseInt(st.getPropertyValue("margin-right"), 10);
          const verticalMargin = parseInt(st.getPropertyValue("margin-top"), 10) + parseInt(st.getPropertyValue("margin-bottom"), 10);
          const width = html.offsetWidth + horizontalMargin;
          const height = html.offsetHeight + verticalMargin;
          if (width === lastWidth && height === lastHeight) return;
          lastWidth = width;
          lastHeight = height;
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
