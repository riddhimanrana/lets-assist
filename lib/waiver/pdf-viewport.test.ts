import { describe, expect, test } from "bun:test";
import { convertPdfRectToViewport } from "./pdf-viewport";

describe("convertPdfRectToViewport", () => {
  test("converts both opposing corners through the viewport transform", () => {
    const calls: Array<[number, number]> = [];
    const viewport = {
      convertToViewportPoint(x: number, y: number) {
        calls.push([x, y]);
        return [x * 2 + 5, 500 - y * 2];
      },
    };

    expect(
      convertPdfRectToViewport(viewport, {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      }),
    ).toEqual([25, 460, 85, 380]);
    expect(calls).toEqual([
      [10, 20],
      [40, 60],
    ]);
  });
});
