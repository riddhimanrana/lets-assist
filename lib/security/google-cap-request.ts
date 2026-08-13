export const GOOGLE_CAP_MAX_BODY_BYTES = 64 * 1024;

const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

export class GoogleCapRequestError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "GoogleCapRequestError";
    this.status = status;
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new GoogleCapRequestError("Invalid Content-Length header", 400);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new GoogleCapRequestError("Invalid Content-Length header", 400);
  }
  return parsed;
}

async function readBoundedBytes(request: Request): Promise<Uint8Array> {
  const contentLength = parseContentLength(
    request.headers.get("content-length"),
  );
  if (contentLength !== null && contentLength > GOOGLE_CAP_MAX_BODY_BYTES) {
    throw new GoogleCapRequestError("Security event token is too large", 413);
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > GOOGLE_CAP_MAX_BODY_BYTES) {
        await reader.cancel("Google CAP body limit exceeded");
        throw new GoogleCapRequestError(
          "Security event token is too large",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function extractJsonToken(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const object = parsed as Record<string, unknown>;
  const candidates = ["token", "security_event_token", "jwt"]
    .map((key) => object[key])
    .filter((value): value is string => typeof value === "string");
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

export async function readGoogleCapToken(request: Request): Promise<string> {
  const bytes = await readBoundedBytes(request);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    throw new GoogleCapRequestError(
      "Security event token must be valid UTF-8",
      400,
    );
  }

  if (!raw) {
    throw new GoogleCapRequestError("Missing security event token", 400);
  }

  const token = raw.startsWith("{") ? extractJsonToken(raw) : raw;
  if (
    !token ||
    token.length > GOOGLE_CAP_MAX_BODY_BYTES ||
    token.trim() !== token ||
    !COMPACT_JWT_PATTERN.test(token)
  ) {
    throw new GoogleCapRequestError("Invalid security event token", 400);
  }

  return token;
}
