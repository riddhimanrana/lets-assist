export async function createWaiverAnalysisRequest(
  file: File,
  requestKey = globalThis.crypto.randomUUID(),
) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const contentDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const body = new FormData();
  body.append("file", file);

  return {
    body,
    headers: {
      "Idempotency-Key": requestKey,
      "X-Waiver-Content-SHA256": contentDigest,
    },
  };
}
