import { USERNAME_REGEX } from "@/schemas/onboarding-schema";

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;

/**
 * Username candidates derived from a person's name.
 *
 * The onboarding modal opened with an empty username box, which asks a student
 * to invent an identifier before they have any idea what the field is for.
 * Most pick something they later regret or stall entirely, and the modal says
 * it "will keep showing up until filled out".
 *
 * Candidates are ordered most-natural first and only ever SUGGESTED: the caller
 * checks availability and the student can replace whatever is filled in. Order
 * is deterministic -- no randomness -- so the same person is offered the same
 * name every time rather than a different one on each reload.
 */

/** Lowercase, strip accents, and keep only what the username rule allows. */
function normalizeSegment(value: string): string {
  return value
    .normalize("NFD")
    // Combining marks, so "Sofía" becomes "sofia" rather than "sofa".
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function isUsable(candidate: string): boolean {
  return (
    candidate.length >= USERNAME_MIN_LENGTH &&
    candidate.length <= USERNAME_MAX_LENGTH &&
    USERNAME_REGEX.test(candidate)
  );
}

/** Truncate without leaving a trailing separator. */
function clamp(candidate: string): string {
  if (candidate.length <= USERNAME_MAX_LENGTH) return candidate;
  return candidate.slice(0, USERNAME_MAX_LENGTH).replace(/-+$/u, "");
}

export function usernameCandidatesFromIdentity(
  fullName?: string | null,
  email?: string | null,
): string[] {
  const parts = String(fullName ?? "")
    .split(/\s+/u)
    .map(normalizeSegment)
    .filter(Boolean);

  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  // The local part is a fallback identity, not a preference: a school address
  // like nina.kapoor28@... still yields a sensible handle when a display name
  // is missing entirely.
  const emailLocal = normalizeSegment(String(email ?? "").split("@")[0] ?? "");

  const bases: string[] = [];
  const push = (value: string) => {
    const candidate = clamp(value);
    if (candidate && !bases.includes(candidate)) bases.push(candidate);
  };

  if (first && last) {
    push(`${first}-${last}`);
    push(`${first}${last}`);
    push(`${first}-${last.slice(0, 1)}`);
  }
  if (first) push(first);
  if (emailLocal) push(emailLocal);

  const candidates: string[] = [];
  for (const base of bases) {
    if (isUsable(base)) candidates.push(base);
  }
  // Numbered fallbacks for the common case where the plain handle is taken.
  for (const base of bases.slice(0, 2)) {
    for (let suffix = 2; suffix <= 4; suffix += 1) {
      const candidate = clamp(`${base}${suffix}`);
      if (isUsable(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

/**
 * The first candidate the availability check accepts.
 *
 * Returns null rather than a taken or rejected handle, so a student is never
 * pre-filled with something that cannot be submitted. Any check failure is
 * treated as "do not suggest": an empty box is a smaller problem than a box
 * containing a name that will be refused.
 */
export async function firstAvailableUsername(
  candidates: readonly string[],
  isAvailable: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      if (await isAvailable(candidate)) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}
