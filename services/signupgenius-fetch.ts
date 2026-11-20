import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { canonicalSignUpGeniusUrl } from "@/lib/signupgenius/url";
import { SignUpGeniusImportError as ImportError } from "@/lib/signupgenius/errors";

export const MAX_SOURCE_BYTES = 1024 * 1024;
export const SOURCE_TIMEOUT_MS = 10000;
type Address = { address: string; family: number };
export type SourceResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  cancel: () => void;
};
export type SourceTransport = {
  resolve: (hostname: string) => Promise<Address[]>;
  request: (
    url: URL,
    address: Address,
    signal: AbortSignal,
  ) => Promise<SourceResponse>;
};

/** Fail closed on non-global, transition, mapped, documentation and reserved networks. */
export function isPublicSourceAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          b === 0 ||
          (b === 88 && c === 99) ||
          (b === 2 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family !== 6 || ip.includes("%") || ip.includes(".")) return false;
  const lower = ip.toLowerCase();
  const first = parseInt(lower.split(":")[0], 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !/^2001:(?:0{0,3}[0-9a-f]{1,2}|0?1[0-9a-f]{2}|0?db8)(?=:)/u.test(lower)
  );
}

const transport: SourceTransport = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: (url, address, signal) =>
    new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          agent: false,
          signal,
          family: address.family,
          // Pin the validated DNS result for the actual socket (no DNS rebinding window).
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          headers: {
            Accept: "text/html",
            "Accept-Encoding": "identity",
            "User-Agent": "LetsAssist-PublicEventImporter/1.0",
          },
        },
        (res) => {
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              location: res.headers.location,
              "content-type": res.headers["content-type"],
              "content-length": res.headers["content-length"],
              "content-encoding": res.headers["content-encoding"],
            },
            body: res,
            cancel: () => res.destroy(),
          });
        },
      );
      req.on("error", reject);
      req.end();
    }),
};

export async function fetchPublicSignUpGenius(
  input: unknown,
  dependencies = transport,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<{ html: string; sourceUrl: string }> {
  let sourceUrl: string;
  try {
    sourceUrl = canonicalSignUpGeniusUrl(input);
  } catch {
    throw new ImportError("invalid_url");
  }
  const controller = new AbortController();
  let response: SourceResponse | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      response?.cancel();
      reject(new ImportError("timeout"));
    }, timeoutMs);
  });
  const work = async () => {
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (controller.signal.aborted) throw new ImportError("timeout");
      const url = new URL(sourceUrl);
      const addresses = await dependencies.resolve(url.hostname);
      if (
        !addresses.length ||
        addresses.some(
          (a) =>
            !isPublicSourceAddress(a.address) || isIP(a.address) !== a.family,
        )
      )
        throw new ImportError("unsafe_address");
      if (controller.signal.aborted) throw new ImportError("timeout");
      response = await dependencies.request(
        url,
        addresses[0],
        controller.signal,
      );
      if (controller.signal.aborted) {
        response.cancel();
        throw new ImportError("timeout");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.cancel();
        if (redirects === 2 || !response.headers.location)
          throw new ImportError("redirect");
        try {
          const target = new URL(response.headers.location, url);
          if (target.protocol !== "https:") throw new Error();
          // Preserve the raw authority for validation (URL normalizes :443 away).
          const location = response.headers.location;
          const candidate = location.startsWith("//")
            ? `https:${location}`
            : /^[a-z][a-z0-9+.-]*:/iu.test(location)
              ? location
              : target.href;
          sourceUrl = canonicalSignUpGeniusUrl(candidate);
        } catch {
          throw new ImportError("redirect");
        }
        continue;
      }
      if ([401, 403, 429].includes(response.status))
        throw new ImportError("unavailable");
      if (
        response.status !== 200 ||
        !/^text\/html(?:;|$)/iu.test(response.headers["content-type"] ?? "") ||
        !["identity", ""].includes(response.headers["content-encoding"] ?? "")
      )
        throw new ImportError("unsupported");
      const length = response.headers["content-length"];
      if (
        length &&
        (!/^\d+$/u.test(length) || Number(length) > MAX_SOURCE_BYTES)
      )
        throw new ImportError("too_large");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > MAX_SOURCE_BYTES) throw new ImportError("too_large");
        chunks.push(chunk);
      }
      const html = Buffer.concat(chunks).toString("utf8");
      // Do not try alternate endpoints, cookies, or challenge solving.
      if (
        /verify you are human|checking your browser|cf-chl-|g-recaptcha|h-captcha/iu.test(
          html,
        )
      )
        throw new ImportError("challenge");
      return { html, sourceUrl };
    }
    throw new ImportError("redirect");
  };
  try {
    return await Promise.race([work(), deadline]);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("unavailable");
  } finally {
    clearTimeout(timer);
    controller.abort();
    response?.cancel();
  }
}
