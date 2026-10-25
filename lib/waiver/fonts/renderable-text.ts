// Letters the standard PDF font cannot encode and Unicode cannot decompose.
const LATIN_FALLBACKS: Record<string, string> = {
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ħ: "h",
  Ħ: "H",
  ı: "i",
  ŧ: "t",
  Ŧ: "T",
};

/** Composed form, one newline style. Every text path starts from this. */
export function normalizeWaiverText(input: unknown): string {
  return (typeof input === "string" ? input : String(input ?? ""))
    .normalize("NFC")
    .replace(/\r\n?/g, "\n");
}

/**
 * Rewrites text so the standard PDF font can always encode it.
 *
 * The standard fonts only cover WinAnsi, and pdf-lib throws on anything else.
 * `substituted` reports that the output no longer matches the input. The
 * renderer reads it two ways: as the signal that a string needs a Unicode
 * font, and, for a character no bundled font holds, as the reason to print the
 * note. In that last case the character is reduced to its base letter where
 * one exists and replaced with "?" otherwise.
 */
export function toRenderableText(
  input: unknown,
  encodable: ReadonlySet<number>,
): { text: string; substituted: boolean } {
  const source = normalizeWaiverText(input);
  let text = "";
  let substituted = false;

  for (const character of source) {
    if (character === "\n") {
      text += character;
      continue;
    }

    const codePoint = character.codePointAt(0) ?? 0;
    if (encodable.has(codePoint)) {
      text += character;
      continue;
    }

    // Tabs, no-break spaces, and other spacing or control characters.
    if (/[\p{Zs}\p{Cc}]/u.test(character)) {
      text += " ";
      continue;
    }

    // Joiners and variation selectors carry no glyph of their own.
    if (/\p{Cf}/u.test(character)) continue;

    substituted = true;
    if (/\p{M}/u.test(character)) continue;

    const base =
      LATIN_FALLBACKS[character] ??
      character.normalize("NFD").replace(/\p{M}/gu, "");
    const baseIsEncodable =
      base.length > 0 &&
      base !== character &&
      Array.from(base).every((part) => encodable.has(part.codePointAt(0) ?? 0));
    text += baseIsEncodable ? base : "?";
  }

  return { text, substituted };
}
