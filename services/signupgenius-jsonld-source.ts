import sanitizeHtml from "sanitize-html";
import { SignUpGeniusImportError as ImportError } from "@/lib/signupgenius/errors";

export const JSONLD_MAX_SCRIPT_BYTES = 64 * 1024;
export const JSONLD_MAX_TOTAL_BYTES = 128 * 1024;
export const JSONLD_MAX_SCRIPTS = 8;
export const JSONLD_MAX_DEPTH = 16;
export const JSONLD_MAX_NODES = 2000;

/** Bound nesting before JSON.parse; no remote contexts, script execution or reference resolution. */
function checkJsonDepth(json: string) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const char of json) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > JSONLD_MAX_DEPTH) throw new ImportError("too_large");
    } else if (char === "}" || char === "]") depth--;
  }
}

export function readJsonLdDocuments(html: string): unknown[] {
  if (Buffer.byteLength(html, "utf8") > 1024 * 1024)
    throw new ImportError("too_large");
  const documents: unknown[] = [];
  const ancestors: string[] = [];
  let totalBytes = 0,
    scriptCount = 0,
    nodes = 0;
  const checkNodes = (value: unknown, depth = 0) => {
    if (++nodes > JSONLD_MAX_NODES || depth > JSONLD_MAX_DEPTH)
      throw new ImportError("too_large");
    if (value && typeof value === "object")
      for (const child of Object.values(value)) checkNodes(child, depth + 1);
  };
  // Use the existing HTML parser through sanitize-html. Its output is discarded;
  // allowed script text is inspected as inert JSON only, never rendered/executed.
  sanitizeHtml(html, {
    allowedTags: ["script"],
    allowedAttributes: { script: ["type", "src"] },
    allowVulnerableTags: true,
    enforceHtmlBoundary: false,
    disallowedTagsMode: "completelyDiscard",
    onOpenTag(name, attributes) {
      ancestors.push(name);
      if (ancestors.length > 128) throw new ImportError("too_large");
      if (
        name === "script" &&
        attributes.type?.trim().toLowerCase() === "application/ld+json" &&
        "src" in attributes
      )
        throw new ImportError("unsupported");
    },
    onCloseTag() {
      ancestors.pop();
    },
    exclusiveFilter(frame) {
      if (frame.tag !== "script") return true;
      if (frame.attribs.type?.trim().toLowerCase() !== "application/ld+json")
        return true;
      if (
        "src" in frame.attribs ||
        ancestors.some((tag) =>
          ["template", "noscript", "iframe", "svg", "math"].includes(tag),
        )
      )
        throw new ImportError("unsupported");
      const bytes = Buffer.byteLength(frame.text, "utf8");
      totalBytes += bytes;
      if (
        ++scriptCount > JSONLD_MAX_SCRIPTS ||
        bytes > JSONLD_MAX_SCRIPT_BYTES ||
        totalBytes > JSONLD_MAX_TOTAL_BYTES
      )
        throw new ImportError("too_large");
      checkJsonDepth(frame.text);
      let document: unknown;
      try {
        document = JSON.parse(frame.text);
      } catch {
        throw new ImportError("unsupported");
      }
      checkNodes(document);
      documents.push(document);
      return true;
    },
  });
  return documents;
}

/** Strip markup before decoding entities; participant subtrees never call this function. */
export function publicEventText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length > 20000) throw new ImportError("too_large");
  const safe = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
  let text = "";
  sanitizeHtml(`<span>${safe}</span>`, {
    allowedTags: ["span"],
    allowedAttributes: {},
    exclusiveFilter(frame) {
      text = frame.text;
      return true;
    },
  });
  return text
    .replace(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63}/giu,
      "[contact removed]",
    )
    .replace(/(?:\+?\d[\d ().-]{6,}\d)/gu, (phone) =>
      /^\d{4}-\d{2}-\d{2}(?: |$)/u.test(phone)
        ? phone
        : phone.replace(/\D/gu, "").length >= 10
          ? "[contact removed]"
          : phone,
    )
    .replace(/\b\d{3}[-. ]\d{4}\b/gu, "[contact removed]")
    .trim();
}
