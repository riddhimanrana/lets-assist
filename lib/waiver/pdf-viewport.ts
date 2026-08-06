export interface PdfViewportPointConverter {
  convertToViewportPoint(x: number, y: number): number[];
}

/** Convert a PDF-space rectangle into viewport coordinates. */
export function convertPdfRectToViewport(
  viewport: PdfViewportPointConverter,
  rect: { x: number; y: number; width: number; height: number },
): [number, number, number, number] {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y);
  const [x2, y2] = viewport.convertToViewportPoint(
    rect.x + rect.width,
    rect.y + rect.height,
  );

  return [x1, y1, x2, y2];
}
