import { describe, expect, test } from "vitest";

import {
  insertToBody,
  insertToHead,
  cspMeta,
  autoResizeScript,
  sizeToPx
} from "./utils";

describe("insertToBody", () => {
  test("returns empty string for undefined html", () => {
    expect(insertToBody(undefined, "<x>")).toBe("");
  });

  test("inserts before </body> (case-insensitive)", () => {
    expect(insertToBody("<body>a</body>", "X")).toBe("<body>aX</body>");
    expect(insertToBody("<BODY>a</BODY>", "X")).toBe("<BODY>aX</BODY>");
  });

  test("appends when there is no body tag", () => {
    expect(insertToBody("<div>a</div>", "X")).toBe("<div>a</div>X");
  });
});

describe("insertToHead", () => {
  test("inserts right after an opening <head>", () => {
    expect(insertToHead("<head><title>t</title></head>", "X")).toBe(
      "<head>X<title>t</title></head>"
    );
  });

  test("inserts before </head> when there is no opening tag match", () => {
    expect(insertToHead("</head><body></body>", "X")).toBe(
      "X</head><body></body>"
    );
  });

  test("prepends when there is no head at all", () => {
    expect(insertToHead("<div>a</div>", "X")).toBe("X<div>a</div>");
  });
});

describe("cspMeta", () => {
  test("builds a CSP meta tag and escapes quotes in the policy", () => {
    expect(cspMeta("default-src 'none'")).toBe(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'">`
    );
    expect(cspMeta('a "b"')).toContain("a &quot;b&quot;");
  });
});

describe("autoResizeScript", () => {
  test("embeds the message key and a ResizeObserver", () => {
    const s = autoResizeScript("__k__");
    expect(s).toContain('"__k__"');
    expect(s).toContain("ResizeObserver");
  });
});

describe("sizeToPx", () => {
  test("numbers become px, strings pass through, undefined drops out", () => {
    expect(sizeToPx(100, "50%")).toEqual(["100px", "50%"]);
    expect(sizeToPx(undefined, 20)).toEqual([undefined, "20px"]);
    expect(sizeToPx(undefined, undefined)).toBeUndefined();
  });
});
