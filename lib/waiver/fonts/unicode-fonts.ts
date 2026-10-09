// fontkit's Indic shaper is compiled against this runtime but does not ship
// it. Without the import, laying out Devanagari throws a ReferenceError.
import "regenerator-runtime/runtime";

import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit, { type Font, type Subset } from "@pdf-lib/fontkit";

import { UNICODE_FONT_FILES, type UnicodeFontFile } from "./font-files";

type TrueTypeSubsetInternals = {
  _addGlyph?: (glyphId: number) => number;
  loca?: { version?: number };
};

/**
 * fontkit 1.1.1 writes a subset's glyph offsets in the short format, which
 * stores each offset halved. Fonts such as Noto Sans and the CJK files hold
 * glyphs of odd byte length, so the halved offsets point one byte off and most
 * outlines come out blank. Choosing the long format before fontkit picks one
 * keeps every offset exact. The dependency is pinned to an exact version, and
 * the renderer's test reads the outlines back from the embedded subset.
 */
function withExactGlyphOffsets(subset: Subset): Subset {
  const internals = subset as unknown as TrueTypeSubsetInternals;
  const addGlyph = internals._addGlyph;
  if (typeof addGlyph === "function") {
    internals._addGlyph = function patched(glyphId) {
      const index = addGlyph.call(this, glyphId);
      if (this.loca) this.loca.version = 1;
      return index;
    };
  }
  return subset;
}

/** The fontkit to register with pdf-lib: the same parser, with safe subsets. */
export const pdfFontkit = {
  create(bytes: Uint8Array, postscriptName?: string): Font {
    const face = fontkit.create(bytes, postscriptName);
    const createSubset = face.createSubset.bind(face);
    face.createSubset = () => withExactGlyphOffsets(createSubset());
    return face;
  },
};

/** A bundled font, parsed once per server instance. */
export interface UnicodeFont {
  id: string;
  bytes: Uint8Array;
  face: Font;
}

const ZERO_WIDTH_JOINERS = /[\u200C\u200D]/gu;

// Parsed fonts outlive the request: reading and parsing the CJK files is the
// expensive part, and it never changes while the process runs.
const loaded = new Map<string, Promise<UnicodeFont>>();

/**
 * Reads one bundled font from disk, or returns null when it cannot be read.
 * A failure is not cached, so a later request tries again.
 */
export function loadUnicodeFont(
  file: UnicodeFontFile,
): Promise<UnicodeFont | null> {
  // Keyed by the resolved path, so the cache can never answer for another root.
  const location = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    file.path,
  );
  let pending = loaded.get(location);
  if (!pending) {
    pending = readFile(location).then((buffer) => {
      const bytes = new Uint8Array(buffer);
      return { id: file.id, bytes, face: fontkit.create(bytes) };
    });
    loaded.set(location, pending);
    pending.catch(() => loaded.delete(location));
  }
  return pending.catch(() => null);
}

/** Whether the font holds a glyph for every character of the text. */
export function fontCovers(font: UnicodeFont, text: string): boolean {
  for (const character of text.replace(ZERO_WIDTH_JOINERS, "")) {
    if (!font.face.hasGlyphForCodePoint(character.codePointAt(0) ?? 0)) {
      return false;
    }
  }
  return true;
}

/** Drops joiners the font has no glyph for, so they never print as a box. */
export function withoutUnsupportedJoiners(
  font: UnicodeFont,
  text: string,
): string {
  return text.replace(ZERO_WIDTH_JOINERS, (joiner) =>
    font.face.hasGlyphForCodePoint(joiner.codePointAt(0) ?? 0) ? joiner : "",
  );
}

/**
 * The bundled fonts in the order to try them for one word: the fonts made for
 * a script in the word first, then the rest of the fallback chain.
 */
export function fontOrderFor(word: string): UnicodeFontFile[] {
  const hinted = UNICODE_FONT_FILES.filter((file) => file.script.test(word));
  const rest = UNICODE_FONT_FILES.filter((file) => !hinted.includes(file));
  return [...hinted, ...rest];
}
