import { expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  UNICODE_TEXT_MAX_DOCUMENT_LENGTH,
  UNICODE_TEXT_MAX_VALUE_LENGTH,
  UnicodeTextBudgetError,
  createUnicodeTextRenderer,
} from "./unicode-text";

async function renderer() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const encodable = new Set(font.getCharacterSet());
  return { page, unicode: createUnicodeTextRenderer(pdfDoc, font, encodable) };
}

const options = { x: 20, y: 700, size: 10, maxWidth: 400 };

test("a value past the per-value limit is refused whole, never cut short", async () => {
  const { page, unicode } = await renderer();
  await expect(
    unicode.draw(page, "名".repeat(UNICODE_TEXT_MAX_VALUE_LENGTH + 1), options),
  ).rejects.toBeInstanceOf(UnicodeTextBudgetError);
  expect(unicode.state.shapedLength).toBe(0);
});

test("a document stops shaping once its allowance is spent", async () => {
  const { page, unicode } = await renderer();
  const value = "名".repeat(UNICODE_TEXT_MAX_VALUE_LENGTH);
  const allowed =
    UNICODE_TEXT_MAX_DOCUMENT_LENGTH / UNICODE_TEXT_MAX_VALUE_LENGTH;
  for (let index = 0; index < allowed; index += 1) {
    await unicode.draw(page, value, options);
  }
  expect(unicode.state.shapedLength).toBe(UNICODE_TEXT_MAX_DOCUMENT_LENGTH);
  await expect(unicode.draw(page, value, options)).rejects.toBeInstanceOf(
    UnicodeTextBudgetError,
  );
  expect(unicode.state.shapedLength).toBe(UNICODE_TEXT_MAX_DOCUMENT_LENGTH);
});
