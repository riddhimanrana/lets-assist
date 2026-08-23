/**
 * Telling the officer why the Drive picker will not open.
 *
 * The Google Picker renders its own failures inside its iframe, as a bare
 * "There was an error! The API developer key is invalid." That sentence is
 * wrong about the cause in the most common case: the key is usually fine and
 * the page's origin is simply not on the key's HTTP-referrer allowlist. An
 * officer reading it has no way to tell those apart, and neither did we --
 * the same message appeared whether the key was rotated, restricted to the
 * wrong domain, or issued from a different Cloud project.
 *
 * So we ask Google ourselves, first, from the browser. The request has to
 * come from the browser rather than the server: referrer restrictions are
 * evaluated against the `Referer` header, so a server-side probe would see a
 * blocked key as valid and report the opposite of the truth.
 *
 * The probe deliberately names a spreadsheet id that cannot exist. A key that
 * passes every restriction gets 404 (no such spreadsheet), which is the
 * success signal; the failures we care about are decided before the lookup
 * and come back with a machine-readable reason.
 */

const PROBE_ENDPOINT =
  "https://sheets.googleapis.com/v4/spreadsheets/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export type GooglePickerKeyDiagnosis =
  /** Carries the key so callers need no second non-null check to use it. */
  | { ok: true; apiKey: string }
  | {
      ok: false;
      reason:
        | "missing"
        | "invalid"
        | "referrer_blocked"
        | "api_disabled"
        | "unreachable";
      message: string;
    };

type GoogleErrorPayload = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{ reason?: string }>;
  };
};

export type GooglePickerKeyProbeVerdict =
  { ok: true } | Extract<GooglePickerKeyDiagnosis, { ok: false }>;

export function interpretGooglePickerKeyProbe(params: {
  status: number;
  payload: GoogleErrorPayload | null;
  origin: string;
}): GooglePickerKeyProbeVerdict {
  const { status, payload, origin } = params;

  // The key cleared every restriction and Google went on to look the
  // spreadsheet up. That is the whole point of probing a nonexistent id.
  if (status === 404 || status === 200) return { ok: true };

  const reason = payload?.error?.details?.find(
    (detail) => detail.reason,
  )?.reason;

  if (reason === "API_KEY_HTTP_REFERRER_BLOCKED") {
    return {
      ok: false,
      reason: "referrer_blocked",
      message: `Google is refusing requests from ${origin}. Add ${origin}/* to the picker API key's website restrictions in Google Cloud, then reload.`,
    };
  }

  if (reason === "API_KEY_INVALID" || status === 400) {
    return {
      ok: false,
      reason: "invalid",
      message:
        "Google rejected the picker API key. It may have been rotated, or it belongs to a different Google Cloud project than the OAuth client.",
    };
  }

  if (reason === "SERVICE_DISABLED") {
    return {
      ok: false,
      reason: "api_disabled",
      message:
        "The Google Sheets API is not enabled for the project that owns the picker API key.",
    };
  }

  return {
    ok: false,
    reason: "unreachable",
    message:
      "Google did not accept the picker API key, and did not say why. Try again in a moment.",
  };
}

export async function diagnoseGooglePickerKey(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  origin: string = typeof window === "undefined" ? "" : window.location.origin,
): Promise<GooglePickerKeyDiagnosis> {
  if (!apiKey) {
    return {
      ok: false,
      reason: "missing",
      message:
        "The Drive picker is not configured for this deployment. NEXT_PUBLIC_GOOGLE_PICKER_API_KEY is missing from the build.",
    };
  }

  try {
    const response = await fetchImpl(
      `${PROBE_ENDPOINT}?key=${encodeURIComponent(apiKey)}&fields=spreadsheetId`,
    );
    const payload = (await response
      .json()
      .catch(() => null)) as GoogleErrorPayload | null;
    const verdict = interpretGooglePickerKeyProbe({
      status: response.status,
      payload,
      origin,
    });
    return verdict.ok ? { ok: true, apiKey } : verdict;
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message:
        "Could not reach Google to check the picker configuration. Check your network and try again.",
    };
  }
}
