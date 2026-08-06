import { describe, expect, mock, test } from "bun:test";

import {
  loadWaiverSourcePdf,
  type WaiverSourceAdminClient,
  WaiverSourcePdfError,
} from "./source-pdf-loader";

const SUPABASE_URL = "https://project.supabase.co";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STORAGE_PATH = `project_waivers/${PROJECT_ID}/source.pdf`;
const LEGACY_URL = `${SUPABASE_URL}/storage/v1/object/public/waiver-uploads/${STORAGE_PATH}`;
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%%EOF");

function makeAdminClient(
  download: ReturnType<typeof mock>,
): WaiverSourceAdminClient {
  return {
    storage: {
      from: mock((bucket: string) => {
        expect(bucket).toBe("waiver-uploads");
        return { download };
      }),
    },
  };
}

function expectCode(code: WaiverSourcePdfError["code"]) {
  return expect.objectContaining({ name: "WaiverSourcePdfError", code });
}

describe("loadWaiverSourcePdf", () => {
  test("loads the canonical Storage path with the admin client and never fetches", async () => {
    const download = mock(async (path: string) => {
      expect(path).toBe(STORAGE_PATH);
      return {
        data: new Blob([PDF_BYTES], { type: "application/pdf" }),
        error: null,
      };
    });
    const fetchImpl = mock(async () => new Response("unexpected"));

    const result = await loadWaiverSourcePdf(
      {
        projectId: PROJECT_ID,
        storagePath: STORAGE_PATH,
        legacyUrl: LEGACY_URL,
      },
      {
        adminClient: makeAdminClient(download),
        configuredSupabaseUrl: SUPABASE_URL,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    expect(result).toEqual(PDF_BYTES);
    expect(download).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("fails closed when canonical Storage download fails", async () => {
    const download = mock(async () => ({
      data: null,
      error: { message: "missing" },
    }));
    const fetchImpl = mock(
      async () =>
        new Response(PDF_BYTES, {
          headers: { "content-type": "application/pdf" },
        }),
    );

    await expect(
      loadWaiverSourcePdf(
        {
          projectId: PROJECT_ID,
          storagePath: STORAGE_PATH,
          legacyUrl: LEGACY_URL,
        },
        {
          adminClient: makeAdminClient(download),
          configuredSupabaseUrl: SUPABASE_URL,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject(expectCode("storage-download-failed"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects a source path belonging to another project", async () => {
    const download = mock();

    await expect(
      loadWaiverSourcePdf(
        {
          projectId: PROJECT_ID,
          storagePath:
            "project_waivers/22222222-2222-4222-8222-222222222222/source.pdf",
        },
        { adminClient: makeAdminClient(download) },
      ),
    ).rejects.toMatchObject(expectCode("invalid-storage-path"));
    expect(download).not.toHaveBeenCalled();
  });

  for (const [label, url] of [
    [
      "localhost",
      "https://localhost/storage/v1/object/public/waiver-uploads/source.pdf",
    ],
    [
      "private address",
      "https://169.254.169.254/storage/v1/object/public/waiver-uploads/source.pdf",
    ],
    [
      "external origin",
      "https://example.com/storage/v1/object/public/waiver-uploads/source.pdf",
    ],
  ] as const) {
    test(`rejects a ${label} legacy URL before fetch`, async () => {
      const fetchImpl = mock(async () => new Response(PDF_BYTES));

      await expect(
        loadWaiverSourcePdf(
          { projectId: PROJECT_ID, legacyUrl: url },
          {
            adminClient: makeAdminClient(mock()),
            configuredSupabaseUrl: SUPABASE_URL,
            fetchImpl: fetchImpl as unknown as typeof fetch,
          },
        ),
      ).rejects.toMatchObject(expectCode("invalid-legacy-url"));
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  }

  test("rejects redirects and requests legacy URLs with redirect following disabled", async () => {
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        expect(init?.cache).toBe("no-store");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      },
    );

    await expect(
      loadWaiverSourcePdf(
        { projectId: PROJECT_ID, legacyUrl: LEGACY_URL },
        {
          adminClient: makeAdminClient(mock()),
          configuredSupabaseUrl: SUPABASE_URL,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject(expectCode("legacy-redirect"));
  });

  test("rejects a legacy response that exceeds the strict byte cap", async () => {
    const fetchImpl = mock(
      async () =>
        new Response(PDF_BYTES, {
          headers: {
            "content-type": "application/pdf",
            "content-length": String(PDF_BYTES.byteLength),
          },
        }),
    );

    await expect(
      loadWaiverSourcePdf(
        { projectId: PROJECT_ID, legacyUrl: LEGACY_URL },
        {
          adminClient: makeAdminClient(mock()),
          configuredSupabaseUrl: SUPABASE_URL,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          maxBytes: PDF_BYTES.byteLength - 1,
        },
      ),
    ).rejects.toMatchObject(expectCode("source-too-large"));
  });

  test("rejects non-PDF legacy responses", async () => {
    const fetchImpl = mock(
      async () =>
        new Response("<html>not a pdf</html>", {
          headers: { "content-type": "text/html" },
        }),
    );

    await expect(
      loadWaiverSourcePdf(
        { projectId: PROJECT_ID, legacyUrl: LEGACY_URL },
        {
          adminClient: makeAdminClient(mock()),
          configuredSupabaseUrl: SUPABASE_URL,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      ),
    ).rejects.toMatchObject(expectCode("invalid-content-type"));
  });

  test("aborts a legacy fetch at the configured timeout", async () => {
    const fetchImpl = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    await expect(
      loadWaiverSourcePdf(
        { projectId: PROJECT_ID, legacyUrl: LEGACY_URL },
        {
          adminClient: makeAdminClient(mock()),
          configuredSupabaseUrl: SUPABASE_URL,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          timeoutMs: 1,
        },
      ),
    ).rejects.toMatchObject(expectCode("legacy-fetch-failed"));
  });

  test("accepts a bounded PDF from the exact configured legacy Storage URL", async () => {
    const fetchImpl = mock(
      async () =>
        new Response(PDF_BYTES, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    );

    const result = await loadWaiverSourcePdf(
      { projectId: PROJECT_ID, legacyUrl: LEGACY_URL },
      {
        adminClient: makeAdminClient(mock()),
        configuredSupabaseUrl: SUPABASE_URL,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    expect(result).toEqual(PDF_BYTES);
  });
});
