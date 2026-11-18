import type { AttemptStorage } from "./staged-waiver-attempt";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function projectCreationSessionId(requested?: string): string {
  return requested && UUID_PATTERN.test(requested)
    ? requested
    : crypto.randomUUID();
}

/** Preserve only bounded editor context across the server's authentication redirect. */
export function projectCreationLoginUrl(search: {
  org?: string;
  draft?: string;
  creation?: string;
  import?: string;
}): string {
  const params = new URLSearchParams();
  for (const field of ["org", "draft"] as const) {
    const value = search[field];
    if (value && /^[A-Za-z0-9_-]{1,128}$/u.test(value))
      params.set(field, value);
  }
  for (const field of ["creation", "import"] as const) {
    const value = search[field];
    if (value && UUID_PATTERN.test(value)) params.set(field, value);
  }
  return params.size
    ? `/login?redirect=${encodeURIComponent(`/projects/create?${params}`)}`
    : "/login?redirect=/projects/create";
}

export function projectCreationUrl(
  href: string,
  sessionId: string,
  draftId?: string,
): string {
  const url = new URL(href);
  url.searchParams.set("creation", sessionId);
  if (draftId) url.searchParams.set("draft", draftId);
  return `${url.pathname}${url.search}${url.hash}`;
}

// A resumed draft keeps its attempt across editor sessions. Unsaved projects
// use the creation ID in their URL. Never import the old unscoped attempt.
export function projectAttemptStorage(
  storage: AttemptStorage | null,
  sessionId: string,
  draftId?: string,
): AttemptStorage | null {
  if (!storage) return null;
  const prefix = draftId ? `draft:${draftId}:` : `creation:${sessionId}:`;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  };
}
