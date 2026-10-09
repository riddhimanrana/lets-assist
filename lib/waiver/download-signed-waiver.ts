/**
 * Browser-side download of one signed waiver through the access-checked route.
 *
 * The route decides the file type (a PDF, or the photo a volunteer uploaded)
 * and names the file to match, so the name is read from the response and never
 * assumed to end in `.pdf`.
 */

const GENERIC_DOWNLOAD_ERROR =
  "The signed waiver could not be downloaded. Please try again.";

/**
 * The file name a response asks to be saved as. Anything that is not a plain
 * file name is discarded in favor of the fallback.
 */
export function filenameFromContentDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  if (!header) return fallback;

  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  const plain =
    /filename\s*=\s*"([^"]*)"/.exec(header)?.[1] ??
    /filename\s*=\s*([^;]+)/.exec(header)?.[1];

  let name = plain?.trim() ?? "";
  if (encoded) {
    try {
      name = decodeURIComponent(encoded.trim());
    } catch {
      // Keep the plain form.
    }
  }

  // A header value never gets to choose a directory or a hidden file.
  const safe = name
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return safe.length > 0 ? safe : fallback;
}

/** The sentence a failed waiver response carries, or a generic one. */
export async function waiverResponseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json();
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string" &&
      body.error.trim().length > 0
    ) {
      return body.error;
    }
  } catch {
    // Not JSON. Fall through.
  }
  return GENERIC_DOWNLOAD_ERROR;
}

/**
 * Fetches the signed waiver and saves it under the name the server gave it.
 * Rejects with a readable message when the server refuses or fails.
 */
export async function downloadSignedWaiver(signatureId: string): Promise<void> {
  const response = await fetch(
    `/api/waivers/${encodeURIComponent(signatureId)}/download`,
  );

  if (!response.ok) {
    throw new Error(await waiverResponseError(response));
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameFromContentDisposition(
    response.headers.get("Content-Disposition"),
    "signed-waiver",
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
