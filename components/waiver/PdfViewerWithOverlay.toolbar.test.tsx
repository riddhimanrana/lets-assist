import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The PDF engine and page canvas are not needed to check the toolbar.
mock.module("pdfjs-dist/webpack.mjs", () => ({ getDocument: () => ({}) }));
mock.module("./pdf-viewer/PdfPage", () => ({ PdfPage: () => null }));

const { PdfViewerWithOverlay } = await import("./PdfViewerWithOverlay");

const noop = () => {};

describe("PDF viewer toolbar", () => {
  const html = renderToStaticMarkup(
    <PdfViewerWithOverlay
      pdfUrl="blob:fictional"
      detectedFields={[]}
      customPlacements={[]}
      onPlacementClick={noop}
      onAddPlacement={noop}
      mode="view"
    />,
  );
  const button = (label: string) =>
    new RegExp(
      `<button[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</button>`,
      "u",
    ).exec(html);

  test("every icon-only toolbar button has a name", () => {
    for (const label of ["Previous page", "Next page", "Zoom out", "Zoom in"]) {
      expect(button(label)).not.toBeNull();
    }
    const buttons = html.match(/<button\b[^>]*>/gu) ?? [];
    expect(buttons).toHaveLength(4);
    for (const tag of buttons) expect(tag).toContain("aria-label=");
  });

  test("icons stay decorative", () => {
    for (const label of ["Previous page", "Next page", "Zoom out", "Zoom in"]) {
      expect(button(label)?.[1]).toContain('aria-hidden="true"');
    }
  });

  test("page bounds still disable navigation before a PDF loads", () => {
    // Page 1 of an unloaded document: no previous or next page.
    expect(button("Previous page")?.[0]).toMatch(/\sdisabled=""/u);
    expect(button("Next page")?.[0]).toMatch(/\sdisabled=""/u);
    // 100% zoom is inside the 50% to 200% bounds.
    expect(button("Zoom out")?.[0]).not.toMatch(/\sdisabled=""/u);
    expect(button("Zoom in")?.[0]).not.toMatch(/\sdisabled=""/u);
  });
});
