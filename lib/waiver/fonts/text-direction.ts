/**
 * A small bidirectional pass for one line of a name or an address.
 *
 * pdf-lib draws glyphs left to right in the order it is given. Hebrew and
 * Arabic read the other way, so a line is cut into pieces that share a font
 * and a direction, and the pieces are put in the order the eye reads them.
 * This covers one level of mixing (a right-to-left name inside left-to-right
 * text, or the reverse, with numbers). It does not implement explicit
 * embedding controls or nested levels, which a name does not use.
 */

export interface DirectedPiece<Font> {
  text: string;
  font: Font;
  rtl: boolean;
}

const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\p{N}/u;
const ATTACHED = /[\p{M}\u200C\u200D]/u;

const MIRRORED: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "«": "»",
  "»": "«",
};

/** Swaps bracket pairs, which face the other way in right-to-left text. */
export function mirrorBrackets(text: string): string {
  return text.replace(/[()[\]{}<>«»]/gu, (bracket) => MIRRORED[bracket]);
}

export function reverseCharacters(text: string): string {
  return Array.from(text).reverse().join("");
}

/** A line reads right to left when its first letter does. */
export function isRtlLine(text: string): boolean {
  for (const character of text) {
    if (LETTER.test(character)) return RTL_LETTER.test(character);
  }
  return false;
}

type Direction = "L" | "R" | "N";

/**
 * Cuts cells that each carry one font into pieces that also carry one
 * direction. Numbers always read left to right. Spaces and punctuation take
 * the direction of the text on both sides, or the line's own direction when
 * the two sides disagree.
 */
export function splitByDirection<Font>(
  cells: ReadonlyArray<{ text: string; font: Font }>,
  baseRtl: boolean,
): DirectedPiece<Font>[] {
  const characters: { character: string; font: Font; direction: Direction }[] =
    [];
  for (const cell of cells) {
    for (const character of cell.text) {
      const previous = characters.at(-1);
      let direction: Direction = "N";
      if (ATTACHED.test(character)) direction = previous?.direction ?? "N";
      else if (DIGIT.test(character)) direction = "L";
      else if (RTL_LETTER.test(character)) direction = "R";
      else if (LETTER.test(character)) direction = "L";
      characters.push({ character, font: cell.font, direction });
    }
  }

  const base: Direction = baseRtl ? "R" : "L";
  for (let start = 0; start < characters.length; start += 1) {
    if (characters[start].direction !== "N") continue;
    let end = start;
    while (end < characters.length && characters[end].direction === "N") {
      end += 1;
    }
    const before = start > 0 ? characters[start - 1].direction : base;
    const after = end < characters.length ? characters[end].direction : base;
    const resolved = before === after ? before : base;
    for (let index = start; index < end; index += 1) {
      characters[index].direction = resolved;
    }
    start = end - 1;
  }

  const pieces: DirectedPiece<Font>[] = [];
  for (const { character, font, direction } of characters) {
    const rtl = direction === "R";
    const last = pieces.at(-1);
    if (last && last.font === font && last.rtl === rtl) last.text += character;
    else pieces.push({ text: character, font, rtl });
  }
  return pieces;
}

/** Puts pieces in the left-to-right order they are drawn on the page. */
export function toVisualOrder<Piece extends { rtl: boolean }>(
  pieces: readonly Piece[],
  baseRtl: boolean,
): Piece[] {
  const ordered = baseRtl ? [...pieces].reverse() : [...pieces];
  const visual: Piece[] = [];
  for (let index = 0; index < ordered.length;) {
    let end = index;
    while (end < ordered.length && ordered[end].rtl !== baseRtl) end += 1;
    if (end === index) {
      visual.push(ordered[index]);
      index += 1;
    } else {
      visual.push(...ordered.slice(index, end).reverse());
      index = end;
    }
  }
  return visual;
}
