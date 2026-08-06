import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("PDF waiver viewer modules", () => {
  test("the established component delegates page and placement rendering", () => {
    const viewer = read("components/waiver/PdfViewerWithOverlay.tsx");
    expect(viewer).toContain('from "./pdf-viewer/PdfPage"');
    expect(viewer).toContain("<PdfPage");
    expect(viewer).not.toContain("function ResizablePlacement");
  });

  test("each client component remains below the component budget", () => {
    for (const path of [
      "components/waiver/PdfViewerWithOverlay.tsx",
      "components/waiver/pdf-viewer/PdfPage.tsx",
      "components/waiver/pdf-viewer/ResizablePlacement.tsx",
      "components/waiver/pdf-viewer/WaiverPlacementValue.tsx",
    ]) {
      const source = read(path);
      expect(source.split("\n").length).toBeLessThanOrEqual(600);
      expect(source).toStartWith('"use client";');
    }
  });
});
