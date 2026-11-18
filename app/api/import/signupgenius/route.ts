import { consumeAiQuota } from "@/lib/ai/rate-limit";
import { getRequestIp } from "@/lib/ai/parse-project-rate-limit-config";
import { canonicalSignUpGeniusUrl } from "@/lib/signupgenius/url";
import { importPreviewSchema } from "@/lib/signupgenius/model";
import {
  IMPORT_ERROR_MESSAGES,
  SignUpGeniusImportError,
} from "@/lib/signupgenius/errors";
import { fetchPublicSignUpGenius } from "@/services/signupgenius-fetch";
import { parsePublicSignUpGenius } from "@/services/signupgenius-parser";

export const runtime = "nodejs";
export const maxDuration = 20;
const response = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

async function readInput(request: Request): Promise<unknown> {
  if (
    !request.body ||
    Number(request.headers.get("content-length") ?? 0) > 4096
  )
    throw new Error();
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 4096) throw new Error();
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error()), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return response({ error: "Use the importer on this site." }, 403);
  if (
    !/^application\/json(?:;|$)/iu.test(
      request.headers.get("content-type") ?? "",
    )
  )
    return response({ error: "Send a signup link as JSON." }, 415);
  let sourceUrl: string;
  try {
    const input = await readInput(request);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("url" in input)
    )
      throw new Error();
    sourceUrl = canonicalSignUpGeniusUrl(input.url);
  } catch {
    return response(
      { code: "invalid_url", error: IMPORT_ERROR_MESSAGES.invalid_url },
      400,
    );
  }
  try {
    const ip = getRequestIp(request.headers);
    const quota = await consumeAiQuota({
      feature: "signupgenius-import",
      windowSeconds: 600,
      buckets: [
        ...(ip ? [{ scope: "ip", identifier: ip, limit: 10 }] : []),
        { scope: "global", identifier: "public-import", limit: 100 },
      ],
    });
    if (!quota.allowed)
      return response(
        { error: "Too many imports. Please try again later." },
        429,
        {
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil((Date.parse(quota.resetAt) - Date.now()) / 1000),
            ),
          ),
        },
      );
  } catch {
    return response(
      { error: "Import is temporarily unavailable. Please try again later." },
      503,
    );
  }
  try {
    const source = await fetchPublicSignUpGenius(sourceUrl);
    const preview = importPreviewSchema.parse(
      parsePublicSignUpGenius(source.html, source.sourceUrl),
    );
    return response({ preview });
  } catch (error) {
    const code =
      error instanceof SignUpGeniusImportError ? error.code : "unsupported";
    return response(
      { code, error: IMPORT_ERROR_MESSAGES[code] },
      code === "timeout" ? 504 : code === "unavailable" ? 502 : 422,
    );
  }
}
