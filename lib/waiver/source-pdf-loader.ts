import "server-only";

import { isIP } from "node:net";

export const WAIVER_SOURCE_BUCKET = "waiver-uploads";
export const MAX_WAIVER_SOURCE_PDF_BYTES = 10 * 1024 * 1024;
export const WAIVER_SOURCE_FETCH_TIMEOUT_MS = 5_000;

const PUBLIC_STORAGE_PATH_PREFIX = `/storage/v1/object/public/${WAIVER_SOURCE_BUCKET}/`;
const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type StorageDownloadError = {
  message?: string;
};

export type WaiverSourceAdminClient = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: Blob | null;
        error: StorageDownloadError | null;
      }>;
    };
  };
};

export type WaiverSourcePdfReference = {
  projectId: string;
  storagePath?: string | null;
  legacyUrl?: string | null;
};

type WaiverSourcePdfLoaderDependencies = {
  adminClient: WaiverSourceAdminClient;
  configuredSupabaseUrl?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
};

export class WaiverSourcePdfError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid-storage-path"
      | "storage-download-failed"
      | "missing-source"
      | "invalid-legacy-url"
      | "legacy-fetch-failed"
      | "legacy-redirect"
      | "invalid-content-type"
      | "source-too-large"
      | "invalid-pdf",
  ) {
    super(message);
    this.name = "WaiverSourcePdfError";
  }
}

function fail(
  code: WaiverSourcePdfError["code"],
  message: string,
): never {
  throw new WaiverSourcePdfError(message, code);
}

/**
 * Storage paths are database capabilities, not arbitrary URL/path inputs.
 * Current upload flows produce this conservative character set.
 */
export function validateWaiverSourceStoragePath(
  value: string,
  expectedProjectId?: string,
): string {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 1_024 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    return fail("invalid-storage-path", "Invalid waiver source Storage path");
  }

  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return fail("invalid-storage-path", "Invalid waiver source Storage path");
  }

  if (
    expectedProjectId &&
    (!UUID_PATTERN.test(expectedProjectId) ||
      !value.startsWith(`project_waivers/${expectedProjectId}/`))
  ) {
    return fail("invalid-storage-path", "Waiver source Storage path belongs to another project");
  }

  return value;
}

function isPrivateOrLocalIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateOrLocalHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  ) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isPrivateOrLocalIpv4(hostname);
  }

  if (ipVersion === 6) {
    if (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      /^fe[89ab]/u.test(hostname)
    ) {
      return true;
    }

    const mappedIpv4 = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
    return mappedIpv4 ? isPrivateOrLocalIpv4(mappedIpv4) : false;
  }

  return false;
}

/** Revalidates a legacy public URL immediately before the network request. */
export function validateLegacyWaiverSourceUrl(
  rawUrl: string,
  configuredSupabaseUrl: string,
  expectedProjectId: string,
): URL {
  let sourceUrl: URL;
  let supabaseUrl: URL;

  try {
    sourceUrl = new URL(rawUrl);
    supabaseUrl = new URL(configuredSupabaseUrl);
  } catch {
    return fail("invalid-legacy-url", "Invalid legacy waiver source URL");
  }

  if (
    sourceUrl.protocol !== "https:" ||
    supabaseUrl.protocol !== "https:" ||
    sourceUrl.origin !== supabaseUrl.origin ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.search ||
    sourceUrl.hash ||
    isPrivateOrLocalHostname(sourceUrl.hostname) ||
    !sourceUrl.pathname.startsWith(PUBLIC_STORAGE_PATH_PREFIX)
  ) {
    return fail("invalid-legacy-url", "Untrusted legacy waiver source URL");
  }

  const objectPath = sourceUrl.pathname.slice(PUBLIC_STORAGE_PATH_PREFIX.length);
  validateWaiverSourceStoragePath(objectPath, expectedProjectId);

  return sourceUrl;
}

function assertPdfContentType(contentType: string | null | undefined): void {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/pdf") {
    fail("invalid-content-type", "Waiver source is not a PDF");
  }
}

function assertPdfBytes(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    fail("source-too-large", "Waiver source PDF is empty or exceeds the size limit");
  }

  if (PDF_HEADER.some((byte, index) => bytes[index] !== byte)) {
    fail("invalid-pdf", "Waiver source does not contain a PDF header");
  }

  return bytes;
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes) {
      fail("source-too-large", "Legacy waiver source exceeds the size limit");
    }
  }

  if (!response.body) {
    return assertPdfBytes(new Uint8Array(await response.arrayBuffer()), maxBytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        fail("source-too-large", "Legacy waiver source exceeds the size limit");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return assertPdfBytes(bytes, maxBytes);
}

async function loadFromStorage(
  storagePath: string,
  expectedProjectId: string,
  adminClient: WaiverSourceAdminClient,
  maxBytes: number,
): Promise<Uint8Array> {
  const path = validateWaiverSourceStoragePath(storagePath, expectedProjectId);
  const { data, error } = await adminClient.storage
    .from(WAIVER_SOURCE_BUCKET)
    .download(path);

  if (error || !data) {
    fail("storage-download-failed", "Waiver source PDF could not be read from Storage");
  }

  assertPdfContentType(data.type);
  if (data.size > maxBytes) {
    fail("source-too-large", "Waiver source PDF exceeds the size limit");
  }

  return assertPdfBytes(new Uint8Array(await data.arrayBuffer()), maxBytes);
}

async function loadFromLegacyUrl(
  legacyUrl: string,
  expectedProjectId: string,
  dependencies: WaiverSourcePdfLoaderDependencies,
  maxBytes: number,
): Promise<Uint8Array> {
  const configuredSupabaseUrl =
    dependencies.configuredSupabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredSupabaseUrl) {
    fail("invalid-legacy-url", "Supabase URL is not configured");
  }

  const sourceUrl = validateLegacyWaiverSourceUrl(
    legacyUrl,
    configuredSupabaseUrl,
    expectedProjectId,
  );
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? WAIVER_SOURCE_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(sourceUrl, {
      method: "GET",
      headers: { Accept: "application/pdf" },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      fail("legacy-redirect", "Legacy waiver source redirects are not allowed");
    }

    if (response.status !== 200) {
      fail("legacy-fetch-failed", "Legacy waiver source could not be downloaded");
    }

    assertPdfContentType(response.headers.get("content-type"));
    return await readBoundedResponseBody(response, maxBytes);
  } catch (error) {
    if (error instanceof WaiverSourcePdfError) throw error;
    fail("legacy-fetch-failed", "Legacy waiver source could not be downloaded");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Loads the immutable waiver source PDF for server-side signature stamping.
 *
 * A persisted Storage object path is authoritative and never falls back to a
 * URL when its object is missing. Public URLs are supported only for rows that
 * predate source-path snapshots, and are tightly restricted before each fetch.
 */
export async function loadWaiverSourcePdf(
  reference: WaiverSourcePdfReference,
  dependencies: WaiverSourcePdfLoaderDependencies,
): Promise<Uint8Array> {
  const maxBytes = dependencies.maxBytes ?? MAX_WAIVER_SOURCE_PDF_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  if (reference.storagePath !== null && reference.storagePath !== undefined) {
    return loadFromStorage(
      reference.storagePath,
      reference.projectId,
      dependencies.adminClient,
      maxBytes,
    );
  }

  if (reference.legacyUrl) {
    return loadFromLegacyUrl(reference.legacyUrl, reference.projectId, dependencies, maxBytes);
  }

  return fail("missing-source", "Waiver source PDF is not available");
}
