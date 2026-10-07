import words from "profane-words";

export const MAX_LOCAL_CONTENT_LENGTH = 2000;

const wordAlternatives = [...new Set(words)]
  .filter((word) => word.length >= 3)
  .map((word) => word.normalize("NFKC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const wordPattern = new RegExp(
  `(?:^|[^\\p{L}\\p{M}])(?:${wordAlternatives})(?=$|[^\\p{L}\\p{M}])`,
  "iu",
);

/** A bounded local word-list check. No submitted text leaves this process. */
export async function checkOffensiveLanguage(
  text: string,
): Promise<{ isProfane: boolean; error?: string }> {
  if (typeof text !== "string" || text.length > MAX_LOCAL_CONTENT_LENGTH) {
    throw new Error("Content is not valid for the local language check.");
  }
  const normalizedText = text.normalize("NFKC").trim();
  const isProfane =
    normalizedText.length > 0 && wordPattern.test(normalizedText);
  return isProfane
    ? { isProfane: true, error: "This content contains inappropriate language" }
    : { isProfane: false };
}
