import {
  PDFHexString,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFName,
  type PDFPage,
} from "pdf-lib";

import { normalizeWaiverText, toRenderableText } from "./renderable-text";
import {
  isRtlLine,
  mirrorBrackets,
  reverseCharacters,
  splitByDirection,
  toVisualOrder,
} from "./text-direction";
import {
  fontCovers,
  fontOrderFor,
  loadUnicodeFont,
  pdfFontkit,
  withoutUnsupportedJoiners,
  type UnicodeFont,
} from "./unicode-fonts";

export interface UnicodeTextOptions {
  x: number;
  y: number;
  size: number;
  maxWidth?: number;
  gray?: boolean;
}

/** One font for a stretch of text. Null is the standard PDF font. */
type FontChoice = UnicodeFont | null;
type Cell = { text: string; font: FontChoice };

interface PositionedGlyph {
  code: PDFHexString;
  dx: number;
  dy: number;
}

/** A piece ready to paint: plain text, or glyphs with their own positions. */
interface ShapedPiece {
  width: number;
  text: string;
  embedded?: { font: PDFFont; glyphs: PositionedGlyph[] };
}

const CLUSTER =
  /[^\p{M}\u200C\u200D][\p{M}\u200C\u200D]*|[\p{M}\u200C\u200D]+/gu;
const BREAKS_ANYWHERE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const VARIATION_SELECTORS = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

/**
 * Splits a value into lines with only characters that can carry a glyph:
 * spacing and control characters become a space, and invisible format
 * characters are dropped except the joiners that steer Indic and Arabic
 * shaping.
 */
function toLines(value: unknown): string[] {
  return normalizeWaiverText(value)
    .replace(/[\p{Zs}\p{Cc}]/gu, (space) => (space === "\n" ? space : " "))
    .replace(/\p{Cf}/gu, (mark) => (/[\u200C\u200D]/u.test(mark) ? mark : ""))
    .replace(VARIATION_SELECTORS, "")
    .split("\n");
}

/**
 * Draws text the standard PDF font cannot encode, for one document.
 *
 * Each word gets the first bundled font that holds all of its glyphs, so a
 * name that mixes scripts renders in full. fontkit shapes every piece
 * (Arabic joining, Devanagari conjuncts, Thai mark stacking) and the glyphs
 * are placed at the positions it reports, which pdf-lib's own `drawText`
 * ignores. Fonts are embedded as subsets, and only when a piece uses them.
 */
/**
 * Shaping costs far more per character than drawing with the standard font,
 * and the text comes from whoever signs the waiver. One value is cut to the
 * first limit, and once a document has shaped the second, the rest of its
 * values take the standard-font path instead.
 */
export const UNICODE_TEXT_MAX_VALUE_LENGTH = 500;
export const UNICODE_TEXT_MAX_DOCUMENT_LENGTH = 5_000;

/** Thrown when a document has used up its shaping allowance. */
export class UnicodeTextBudgetError extends Error {
  constructor() {
    super("Unicode text budget spent");
    this.name = "UnicodeTextBudgetError";
  }
}

export function createUnicodeTextRenderer(
  pdfDoc: PDFDocument,
  standardFont: PDFFont,
  encodable: ReadonlySet<number>,
) {
  const embedded = new Map<string, Promise<PDFFont>>();
  const fontKeys = new Map<PDFPage, Map<PDFFont, PDFName>>();
  const state = { embeddedFonts: 0, fontUnavailable: false, shapedLength: 0 };
  let fontkitRegistered = false;

  const isEncodable = (text: string) =>
    Array.from(text).every((part) => encodable.has(part.codePointAt(0) ?? 0));

  const embed = (font: UnicodeFont): Promise<PDFFont> => {
    let pending = embedded.get(font.id);
    if (!pending) {
      if (!fontkitRegistered) {
        pdfDoc.registerFontkit(pdfFontkit);
        fontkitRegistered = true;
      }
      pending = pdfDoc.embedFont(font.bytes, { subset: true });
      embedded.set(font.id, pending);
      state.embeddedFonts += 1;
    }
    return pending;
  };

  /** Chooses fonts for one word. Reports whether a character was degraded. */
  const assignWord = async (
    word: string,
  ): Promise<{ cells: Cell[]; substituted: boolean }> => {
    if (isEncodable(word)) {
      return { cells: [{ text: word, font: null }], substituted: false };
    }

    const candidates: UnicodeFont[] = [];
    for (const file of fontOrderFor(word)) {
      const font = await loadUnicodeFont(file);
      if (!font) {
        state.fontUnavailable = true;
        continue;
      }
      if (fontCovers(font, word)) {
        return { cells: [{ text: word, font }], substituted: false };
      }
      candidates.push(font);
    }

    // No single font holds the word, so each character finds its own.
    const cells: Cell[] = [];
    let substituted = false;
    for (const cluster of word.match(CLUSTER) ?? []) {
      let font: FontChoice = null;
      let text = cluster;
      if (!isEncodable(cluster)) {
        font = candidates.find((one) => fontCovers(one, cluster)) ?? null;
        if (!font) {
          text = toRenderableText(cluster, encodable).text;
          substituted = true;
        }
      }
      const last = cells.at(-1);
      if (last && last.font === font) last.text += text;
      else cells.push({ text, font });
    }
    return { cells, substituted };
  };

  const widthOf = (cells: readonly Cell[], size: number) =>
    cells.reduce((total, { text, font }) => {
      if (!font) return total + standardFont.widthOfTextAtSize(text, size);
      const run = font.face.layout(withoutUnsupportedJoiners(font, text));
      return total + (run.advanceWidth * size) / font.face.unitsPerEm;
    }, 0);

  const shape = async (
    piece: { text: string; font: FontChoice; rtl: boolean },
    size: number,
  ): Promise<ShapedPiece> => {
    const { font, rtl } = piece;
    if (!font) {
      // The standard font always draws left to right.
      const text = rtl
        ? reverseCharacters(mirrorBrackets(piece.text))
        : piece.text;
      return { text, width: standardFont.widthOfTextAtSize(text, size) };
    }

    let text = withoutUnsupportedJoiners(font, piece.text);
    if (rtl) text = mirrorBrackets(text);
    let run = font.face.layout(text);
    // fontkit reverses a run when the script it detects reads right to left.
    // Where that disagrees with the direction resolved for this piece (digits
    // in an Arabic font, punctuation between Hebrew words), reverse the input.
    if ((run.direction === "rtl") !== rtl) {
      text = reverseCharacters(text);
      run = font.face.layout(text);
    }

    const pdfFont = await embed(font);
    const codes = pdfFont.encodeText(text).asString();
    if (codes.length !== run.glyphs.length * 4) {
      throw new Error("Shaped glyphs do not match the embedded font");
    }

    const scale = size / font.face.unitsPerEm;
    const glyphs: PositionedGlyph[] = [];
    let pen = 0;
    run.positions.forEach((position, index) => {
      glyphs.push({
        code: PDFHexString.of(codes.slice(index * 4, index * 4 + 4)),
        dx: (pen + position.xOffset) * scale,
        dy: position.yOffset * scale,
      });
      pen += position.xAdvance;
    });
    return { text, width: pen * scale, embedded: { font: pdfFont, glyphs } };
  };

  const fontKeyFor = (page: PDFPage, font: PDFFont): PDFName => {
    const keys = fontKeys.get(page) ?? new Map<PDFFont, PDFName>();
    fontKeys.set(page, keys);
    const key =
      keys.get(font) ?? page.node.newFontDictionary(font.name, font.ref);
    keys.set(font, key);
    return key;
  };

  /**
   * Lays the value out, then paints it. Everything that can fail (reading a
   * font, shaping) happens before the first glyph is painted, so a caller
   * that catches an error can fall back without leaving half a line behind.
   */
  const draw = async (
    page: PDFPage,
    value: unknown,
    options: UnicodeTextOptions,
  ): Promise<{ substituted: boolean }> => {
    const { size, maxWidth } = options;
    let substituted = false;
    const lines: ShapedPiece[][] = [];

    const bounded = Array.from(String(value ?? ""))
      .slice(0, UNICODE_TEXT_MAX_VALUE_LENGTH)
      .join("");
    if (
      state.shapedLength + bounded.length >
      UNICODE_TEXT_MAX_DOCUMENT_LENGTH
    ) {
      throw new UnicodeTextBudgetError();
    }
    state.shapedLength += bounded.length;

    for (const source of toLines(bounded)) {
      // Words and the spaces between them, each a wrap opportunity.
      const tokens: Cell[][] = [];
      for (const word of source.split(/( +)/u)) {
        if (word.length === 0) continue;
        const assigned = await assignWord(word);
        substituted ||= assigned.substituted;
        const tooWide =
          maxWidth !== undefined && widthOf(assigned.cells, size) > maxWidth;
        if (tooWide && BREAKS_ANYWHERE.test(word)) {
          for (const { text, font } of assigned.cells) {
            for (const cluster of text.match(CLUSTER) ?? []) {
              tokens.push([{ text: cluster, font }]);
            }
          }
        } else {
          tokens.push(assigned.cells);
        }
      }

      const wrapped: Cell[][] = [[]];
      let lineWidth = 0;
      for (const token of tokens) {
        const isSpace = token.every((cell) => cell.text.trim().length === 0);
        const tokenWidth = widthOf(token, size);
        const current = wrapped.at(-1) ?? [];
        if (
          maxWidth !== undefined &&
          current.length > 0 &&
          lineWidth + tokenWidth > maxWidth
        ) {
          wrapped.push([]);
          lineWidth = 0;
          if (isSpace) continue;
        }
        wrapped.at(-1)?.push(...token);
        lineWidth += tokenWidth;
      }

      for (const cells of wrapped) {
        const baseRtl = isRtlLine(cells.map((cell) => cell.text).join(""));
        const pieces = toVisualOrder(splitByDirection(cells, baseRtl), baseRtl);
        const shaped: ShapedPiece[] = [];
        for (const piece of pieces) shaped.push(await shape(piece, size));
        lines.push(shaped);
      }
    }

    const shade = options.gray ? 0.5 : 0;
    lines.forEach((line, lineIndex) => {
      const y = options.y - lineIndex * size;
      let x = options.x;
      for (const piece of line) {
        if (!piece.embedded) {
          if (piece.text.trim().length > 0) {
            page.drawText(piece.text, {
              x,
              y,
              size,
              font: standardFont,
              color: rgb(shade, shade, shade),
            });
          }
        } else {
          const { font, glyphs } = piece.embedded;
          page.pushOperators(
            pushGraphicsState(),
            beginText(),
            setFillingRgbColor(shade, shade, shade),
            setFontAndSize(fontKeyFor(page, font), size),
            ...glyphs.flatMap((glyph) => [
              setTextMatrix(1, 0, 0, 1, x + glyph.dx, y + glyph.dy),
              showText(glyph.code),
            ]),
            endText(),
            popGraphicsState(),
          );
        }
        x += piece.width;
      }
    });

    return { substituted };
  };

  return { draw, state };
}
