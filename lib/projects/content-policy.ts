import { checkOffensiveLanguage } from "@/utils/moderation-helpers";
import sanitizeHtml from "sanitize-html";

export async function projectContentIssue(content: {
  title?: string;
  location?: string;
  description?: string;
}) {
  for (const field of ["title", "location", "description"] as const) {
    const text = content[field];
    if (typeof text !== "string") continue;
    const plain =
      field === "description"
        ? sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
        : text;
    const result = await checkOffensiveLanguage(plain);
    if (result.isProfane)
      return `Review the project ${field}: ${result.error}.`;
  }
  return null;
}
