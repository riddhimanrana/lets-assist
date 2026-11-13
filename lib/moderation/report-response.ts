/** Proxies can return text or HTML before the report route runs. */
export async function readContentReportResponse(
  response: Response,
): Promise<void> {
  const body: unknown = await response.json().catch(() => null);
  if (
    response.ok &&
    body &&
    typeof body === "object" &&
    "success" in body &&
    body.success === true
  )
    return;
  if (response.status === 401)
    throw new Error(
      "Sign in again to submit your report. Your description is still here.",
    );
  if (response.status === 503)
    throw new Error(
      "Reporting is temporarily unavailable. Wait a moment and retry. Your description is still here.",
    );
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  )
    throw new Error(body.error);
  throw new Error(
    "Your report could not be confirmed. Retry without closing this dialog.",
  );
}
