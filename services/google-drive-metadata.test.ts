import { afterEach, describe, expect, mock, test } from "bun:test";

import { getGoogleDriveFileMetadata } from "./google-sheets";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getGoogleDriveFileMetadata", () => {
  test("returns the selected file provenance without fetching row values", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "sheet-1",
      name: "CSF responses",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: "2026-07-15T12:00:00.000Z",
      webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      trashed: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getGoogleDriveFileMetadata("token", "sheet-1")).resolves.toEqual({
      id: "sheet-1",
      name: "CSF responses",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: "2026-07-15T12:00:00.000Z",
      webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      trashed: false,
      accessState: "accessible",
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("fields=id%2Cname%2CmimeType%2CmodifiedTime%2CwebViewLink%2Ctrashed");
    expect(url).not.toContain("values");
  });

  test("turns lost consent into a reconnect state without exposing an error body", async () => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response("private provider detail", { status: 403 })
    )) as unknown as typeof fetch;
    const result = await getGoogleDriveFileMetadata("token", "sheet-2");
    expect(result).toMatchObject({ id: "sheet-2", accessState: "reconnect_required" });
    expect(result.name).toBeNull();
  });

  test.each([
    [401, "reconnect_required"],
    [403, "reconnect_required"],
    [404, "not_found"],
    [429, "unknown"],
  ] as const)("maps Drive HTTP %i to %s", async (status, accessState) => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response("provider detail is not surfaced", { status })
    )) as unknown as typeof fetch;
    await expect(getGoogleDriveFileMetadata("token", `sheet-${status}`)).resolves.toMatchObject({ accessState });
  });

  test("marks a selected file that moved to trash without dropping its provenance", async () => {
    globalThis.fetch = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "sheet-trashed",
      name: "Historical CSF source",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: "2026-07-15T12:00:00.000Z",
      webViewLink: "https://docs.google.com/spreadsheets/d/sheet-trashed/edit",
      trashed: true,
    }), { status: 200 })) as unknown as typeof fetch;

    await expect(getGoogleDriveFileMetadata("token", "sheet-trashed")).resolves.toMatchObject({
      id: "sheet-trashed",
      name: "Historical CSF source",
      trashed: true,
      accessState: "trashed",
    });
  });
});
