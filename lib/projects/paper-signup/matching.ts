/**
 * Fuzzy matching of transcribed paper-sheet rows against a project's existing
 * signups. Pure and deterministic: same inputs, same proposal.
 *
 * A match is only ever a review-table pre-selection. Nothing here commits;
 * the organizer confirms every row, and the commit RPC re-derives identity
 * from the email at commit time.
 *
 * Intentionally parallels the bigram matcher in the private CSF plugin
 * (profile-link-suggestions); plugin code cannot be imported into the public
 * platform tree, so the algorithm is reimplemented here.
 */

export type PaperMatchReason =
  | "exact_email"
  | "exact_phone"
  | "exact_name"
  | "swapped_name"
  | "name_similarity"
  | "email_local_similarity";

export interface PaperMatchCandidate {
  signupId: string | null;
  userId: string | null;
  anonymousId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface PaperMatchResult {
  kind: "none" | "existing_signup" | "existing_profile" | "existing_anonymous";
  signupId: string | null;
  userId: string | null;
  anonymousId: string | null;
  score: number;
  reasons: PaperMatchReason[];
}

/** Auto-propose the match (pre-checked include) at or above this score. */
export const MATCH_AUTO_THRESHOLD = 0.82;
/** Attach the match with a "verify this" flag at or above this score. */
export const MATCH_REVIEW_THRESHOLD = 0.6;

const NO_MATCH: PaperMatchResult = {
  kind: "none",
  signupId: null,
  userId: null,
  anonymousId: null,
  score: 0,
  reasons: [],
};

/** trim -> lowercase -> strip diacritics -> collapse spaces -> alphanumerics. */
export function normalizeIdentityText(
  value: string | null | undefined,
): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || !email.includes("@")) return null;
  return email;
}

/** Digits only; a leading US country code is dropped; under 10 digits is noise. */
export function normalizePhoneDigits(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits.length >= 10 ? digits : null;
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function bigramDiceSimilarity(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      counts.set(gram, remaining - 1);
      intersection += 1;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

interface NameParts {
  full: string;
  first: string;
  last: string;
}

function splitName(normalized: string): NameParts | null {
  if (normalized.length === 0) return null;
  const tokens = normalized.split(" ");
  return {
    full: normalized,
    first: tokens[0],
    last: tokens[tokens.length - 1],
  };
}

function emailLocalPart(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : null;
}

interface ScoredCandidate {
  score: number;
  reasons: PaperMatchReason[];
}

function scoreCandidate(
  row: { name: NameParts | null; email: string | null; phone: string | null },
  candidate: {
    name: NameParts | null;
    email: string | null;
    phone: string | null;
  },
): ScoredCandidate {
  // Exact email is identity; nothing outranks it.
  if (row.email && candidate.email && row.email === candidate.email) {
    return { score: 1, reasons: ["exact_email"] };
  }

  let score = 0;
  const reasons: PaperMatchReason[] = [];

  const nameSimilarity =
    row.name && candidate.name
      ? bigramDiceSimilarity(row.name.full, candidate.name.full)
      : 0;

  if (
    row.phone &&
    candidate.phone &&
    row.phone === candidate.phone &&
    nameSimilarity >= 0.6
  ) {
    score = 0.95;
    reasons.push("exact_phone");
  } else if (row.name && candidate.name) {
    if (row.name.full === candidate.name.full) {
      score = 0.9;
      reasons.push("exact_name");
    } else if (
      row.name.first === candidate.name.last &&
      row.name.last === candidate.name.first &&
      row.name.first !== row.name.last
    ) {
      score = 0.85;
      reasons.push("swapped_name");
    } else {
      const firstSim = bigramDiceSimilarity(
        row.name.first,
        candidate.name.first,
      );
      const lastSim = bigramDiceSimilarity(row.name.last, candidate.name.last);
      if (firstSim >= 0.7 && lastSim >= 0.7) {
        score = 0.8 * Math.min(firstSim, lastSim);
        reasons.push("name_similarity");
      }
    }
  }

  const rowLocal = emailLocalPart(row.email);
  const candidateLocal = emailLocalPart(candidate.email);
  if (
    score > 0 &&
    rowLocal &&
    candidateLocal &&
    bigramDiceSimilarity(rowLocal, candidateLocal) >= 0.85
  ) {
    score = Math.min(score + 0.1, 0.95);
    reasons.push("email_local_similarity");
  }

  return { score, reasons };
}

function resultKind(candidate: PaperMatchCandidate): PaperMatchResult["kind"] {
  if (candidate.signupId) return "existing_signup";
  if (candidate.userId) return "existing_profile";
  if (candidate.anonymousId) return "existing_anonymous";
  return "none";
}

/**
 * Score a transcribed row against every candidate and return the best
 * proposal. Ties keep the earliest candidate, so callers should order the
 * candidate list deterministically (by created_at).
 */
export function matchPaperRow(
  row: { name: string | null; email: string | null; phone: string | null },
  candidates: PaperMatchCandidate[],
): PaperMatchResult {
  const rowIdentity = {
    name: splitName(normalizeIdentityText(row.name)),
    email: normalizeEmail(row.email),
    phone: normalizePhoneDigits(row.phone),
  };

  let best: PaperMatchResult = NO_MATCH;

  for (const candidate of candidates) {
    const scored = scoreCandidate(rowIdentity, {
      name: splitName(normalizeIdentityText(candidate.name)),
      email: normalizeEmail(candidate.email),
      phone: normalizePhoneDigits(candidate.phone),
    });

    if (scored.score > best.score) {
      best = {
        kind: resultKind(candidate),
        signupId: candidate.signupId,
        userId: candidate.userId,
        anonymousId: candidate.anonymousId,
        score: scored.score,
        reasons: scored.reasons,
      };
      if (best.score === 1) break;
    }
  }

  return best.score >= MATCH_REVIEW_THRESHOLD ? best : NO_MATCH;
}
