import { describe, expect, test } from "vitest";

import { insertToBody, autoResizeScript, sizeToPx } from "./utils";

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
