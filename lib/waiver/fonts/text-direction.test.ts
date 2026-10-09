import { describe, expect, test } from "bun:test";

import {
  isRtlLine,
  mirrorBrackets,
  splitByDirection,
  toVisualOrder,
} from "./text-direction";

/** The pieces of a one-font line, in the order they are drawn. */
function visual(text: string): { text: string; rtl: boolean }[] {
  const baseRtl = isRtlLine(text);
  return toVisualOrder(
    splitByDirection([{ text, font: "font" }], baseRtl),
    baseRtl,
  ).map(({ text: piece, rtl }) => ({ text: piece, rtl }));
}

describe("text direction", () => {
  test("left-to-right text stays one piece", () => {
    expect(visual("Alex Johnson, 12 Main St.")).toEqual([
      { text: "Alex Johnson, 12 Main St.", rtl: false },
    ]);
  });

  test("a right-to-left name keeps its spaces inside one piece", () => {
    expect(isRtlLine("דוד כהן")).toBe(true);
    expect(visual("דוד כהן")).toEqual([{ text: "דוד כהן", rtl: true }]);
  });

  test("a right-to-left name inside left-to-right text keeps its place", () => {
    expect(visual("Name: דוד כהן signed")).toEqual([
      { text: "Name: ", rtl: false },
      { text: "דוד כהן", rtl: true },
      { text: " signed", rtl: false },
    ]);
  });

  test("numbers in right-to-left text read left to right, drawn on the left", () => {
    expect(visual("רחוב 12")).toEqual([
      { text: "12", rtl: false },
      { text: "רחוב ", rtl: true },
    ]);
    expect(visual("رقم ٠١٢ شارع")).toEqual([
      { text: " شارع", rtl: true },
      { text: "٠١٢", rtl: false },
      { text: "رقم ", rtl: true },
    ]);
  });

  test("the first letter sets the line's direction, not a digit", () => {
    expect(isRtlLine("12 דוד")).toBe(true);
    expect(isRtlLine("12 Main")).toBe(false);
    expect(isRtlLine("123")).toBe(false);
  });

  test("pieces are cut where the font changes", () => {
    const pieces = splitByDirection(
      [
        { text: "דוד", font: "hebrew" },
        { text: " ", font: "standard" },
        { text: "כהן", font: "hebrew" },
      ],
      true,
    );
    expect(toVisualOrder(pieces, true).map((piece) => piece.text)).toEqual([
      "כהן",
      " ",
      "דוד",
    ]);
    expect(pieces.every((piece) => piece.rtl)).toBe(true);
  });

  test("brackets are mirrored for right-to-left pieces", () => {
    expect(mirrorBrackets("(a) [b] {c} <d>")).toBe(")a( ]b[ }c{ >d<");
  });
});
