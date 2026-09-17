export const RICH_TEXT_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

export const RICH_TEXT_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "target", "rel", "class"],
};

export const RICH_TEXT_ALLOWED_ATTR = [
  ...new Set(Object.values(RICH_TEXT_ALLOWED_ATTRIBUTES).flat()),
];

export const RICH_TEXT_ALLOWED_SCHEMES = [
  "http",
  "https",
  "mailto",
  "tel",
] as const;

export const RICH_TEXT_ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel):|[#/?]|\.{1,2}\/)/i;

const SCRIPT_TAG_PATTERN =
  /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\b[^>]*>/gi;

const SAFE_LINK_PROTOCOLS = new Set(
  RICH_TEXT_ALLOWED_SCHEMES.map((scheme) => `${scheme}:`),
);
const DOMAIN_LIKE_URL_REGEX =
  /^(?:localhost(?::\d+)?|(?:[\w-]+\.)+[a-z]{2,})(?:[/?#].*)?$/i;

const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function trimTrailingEmptyParagraphs(html: string): string {
  return html.replace(/(?:<p>(?:\s*<br\s*\/?>\s*|\s*)<\/p>\s*)+$/gi, "").trim();
}

export function stripScriptTags(html: string): string {
  if (!html) {
    return "";
  }

  let previous: string;
  let sanitized = html;

  do {
    previous = sanitized;
    sanitized = sanitized.replace(SCRIPT_TAG_PATTERN, "");
  } while (sanitized !== previous);

  return sanitized;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => HTML_ESCAPE_LOOKUP[char] || char,
  );
}

export function escapeHtmlWithLineBreaks(value: unknown): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br />");
}

const HTML_ENTITY_LOOKUP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeRichTextEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#160);/gi,
    (entity) => HTML_ENTITY_LOOKUP[entity.toLowerCase()] ?? entity,
  );
}

/**
 * Project canonical rich text (sanitized HTML) onto plain-text blocks for
 * channels that cannot render HTML.
 *
 * Paragraphs stay separate blocks, hard breaks stay line breaks inside a block,
 * and a list stays one block whose lines carry their own marker. Plain-text
 * bodies written before rich text split on their own blank lines.
 */
export function richTextToPlainTextBlocks(
  html: string | null | undefined,
  { maxBlocks = 40 }: { maxBlocks?: number } = {},
): string[] {
  if (!html) return [];

  const blocks: string[][] = [];
  const listStack: { ordered: boolean; itemNumber: number }[] = [];
  let lines: string[] = [];
  let lineIndent = "";
  let lineMarker = "";
  let lineText = "";

  // `keepEmpty` marks an author's own blank line (a hard break); structural
  // boundaries must not leave one behind. Newlines inside a text run belong to
  // plain-text bodies, so only horizontal whitespace collapses.
  const endLine = (keepEmpty = false) => {
    const text = lineText
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (text.length > 0) lines.push(`${lineIndent}${lineMarker}${text}`);
    else if (keepEmpty) lines.push("");
    lineIndent = "";
    lineMarker = "";
    lineText = "";
  };
  const endBlock = () => {
    endLine();
    if (lines.length > 0) blocks.push(lines);
    lines = [];
  };

  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    lineText += decodeRichTextEntities(html.slice(cursor, match.index));
    cursor = tagPattern.lastIndex;

    const tag = match[1].toLowerCase();
    const isClosing = match[0].startsWith("</");

    if (tag === "br") {
      endLine(true);
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      if (isClosing) {
        listStack.pop();
        if (listStack.length === 0) endBlock();
        continue;
      }
      // A list is its own block, so whatever preceded it closes first.
      if (listStack.length === 0) endBlock();
      listStack.push({ ordered: tag === "ol", itemNumber: 0 });
      continue;
    }

    if (tag === "li") {
      endLine();
      if (isClosing) continue;
      const list = listStack[listStack.length - 1];
      lineIndent = "  ".repeat(Math.max(listStack.length - 1, 0));
      if (list?.ordered) {
        list.itemNumber += 1;
        lineMarker = `${list.itemNumber}. `;
      } else {
        lineMarker = "• ";
      }
      continue;
    }

    if (isClosing && /^(?:p|div|h[1-6]|blockquote|pre)$/.test(tag)) {
      // Inside a list this is the item's own text: it ends the line without
      // splitting the list into separate blocks.
      if (listStack.length > 0) endLine();
      else endBlock();
    }
  }

  lineText += decodeRichTextEntities(html.slice(cursor));
  endBlock();

  return blocks
    .map((blockLines) => blockLines.join("\n").replace(/^\n+|\n+$/g, ""))
    .flatMap((block) => block.split(/\n{2,}/))
    .filter((block) => block.trim().length > 0)
    .slice(0, maxBlocks);
}

export function normalizeRichTextLinkUrl(input: string): string | null {
  const value = input.trim();

  if (!value) {
    return "";
  }

  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("?")
  ) {
    return value;
  }

  const hasExplicitScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);

  if (!hasExplicitScheme && DOMAIN_LIKE_URL_REGEX.test(value)) {
    return `https://${value}`;
  }

  try {
    const parsedUrl = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(parsedUrl.protocol.toLowerCase())
      ? value
      : null;
  } catch {
    return null;
  }
}
