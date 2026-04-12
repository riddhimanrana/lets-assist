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

export const RICH_TEXT_ALLOWED_ATTR = [...new Set(Object.values(RICH_TEXT_ALLOWED_ATTRIBUTES).flat())];

export const RICH_TEXT_ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"] as const;

export const RICH_TEXT_ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[#/?]|\.{1,2}\/)/i;

const SCRIPT_TAG_PATTERN = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;

const SAFE_LINK_PROTOCOLS = new Set(RICH_TEXT_ALLOWED_SCHEMES.map((scheme) => `${scheme}:`));
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

  return html.replace(SCRIPT_TAG_PATTERN, "");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPE_LOOKUP[char] || char);
}

export function escapeHtmlWithLineBreaks(value: unknown): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br />");
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
    return SAFE_LINK_PROTOCOLS.has(parsedUrl.protocol.toLowerCase()) ? value : null;
  } catch {
    return null;
  }
}