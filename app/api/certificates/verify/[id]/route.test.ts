import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const certificate = {
  id: "certificate",
  project_id: "project",
  project_title: "Fictional cleanup",
  project_location: "Fictional park",
  organization_name: "Fictional organization",
  creator_id: "creator",
  creator_name: "Supervisor",
  is_certified: true,
  event_start: "2026-10-06T16:00:00Z",
  event_end: "2026-10-06T17:15:00Z",
  volunteer_name: "Fictional volunteer",
  volunteer_email: "volunteer@example.test",
  issued_at: "2026-10-06T18:00:00Z",
  type: "platform",
};
let missing = false;
let failed = false;
let malformedDates = false;
let creditedMinutes: number | null | undefined;
/** An error the query returns instead of throwing, as PostgREST does. */
let returnedError: { code?: string; message: string } | null = null;
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (failed) throw new Error("Synthetic read failure");
            if (returnedError) return { data: null, error: returnedError };
            return {
              data: missing
                ? null
                : {
                    ...certificate,
                    credited_minutes: creditedMinutes,
                    ...(malformedDates ? { event_end: "invalid" } : {}),
                  },
              error: null,
            };
          },
        }),
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");
const params = { params: Promise.resolve({ id: "certificate" }) };
const expectedData = {
  projectTitle: certificate.project_title,
  organizerName: certificate.creator_name,
  organizationName: certificate.organization_name,
  duration: "1.3",
  certificationStatus: "Certified",
};
function request(body?: unknown) {
  return new NextRequest(
    "http://localhost/api/certificates/verify/certificate",
    {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

describe("certificate verification contract", () => {
  beforeEach(() => {
    missing = false;
    failed = false;
    malformedDates = false;
    creditedMinutes = undefined;
    returnedError = null;
  });
  test("GET includes numeric duration matching the exported one-decimal hours", async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect((await response.json()).event.duration).toBe(1.3);
  });
  test.each([61, 0])(
    "canonical %i credited minutes override the event envelope",
    async (minutes) => {
      creditedMinutes = minutes;
      const response = await POST(
        request({ expectedData: { ...expectedData, duration: minutes / 60 } }),
        params,
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.event.duration).toBe(minutes / 60);
      expect(body.event.creditedMinutes).toBe(minutes);
      expect(body.verification.matches.hours).toBe(true);
    },
  );
  test("POST compares matching data and detects changed hours", async () => {
    const match = await POST(request({ expectedData }), params);
    expect((await match.json()).verification.matches).toEqual({
      certificateId: true,
      title: true,
      organizer: true,
      organization: true,
      hours: true,
      status: true,
    });
    const mismatch = await POST(
      request({ expectedData: { ...expectedData, duration: 2 } }),
      params,
    );
    expect((await mismatch.json()).verification.matches.hours).toBe(false);
  });
  test("POST preserves missing-certificate status", async () => {
    missing = true;
    const response = await POST(request({ expectedData }), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      valid: false,
      exists: false,
    });
  });
  test("POST preserves internal read failure status", async () => {
    failed = true;
    const response = await POST(request({ expectedData }), params);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ valid: false, retryable: true });
    expect(body).not.toHaveProperty("exists");
  });

  const backendFailures = [
    { code: "08006", message: "Synthetic connection failure" },
    { code: "57014", message: "Synthetic statement timeout" },
    { code: "PGRST301", message: "Synthetic gateway failure" },
    { code: "XX000", message: "Synthetic timeout with an unreviewed code" },
    { message: "TypeError: fetch failed" },
  ];
  for (const failure of backendFailures) {
    test(`a returned ${failure.code ?? "transport"} error is a retryable 503 that claims nothing about existence`, async () => {
      returnedError = failure;
      const originalError = console.error;
      console.error = () => {};

      try {
        const response = await GET(request(), params);
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("5");
        expect(body).toMatchObject({ valid: false, retryable: true });
        expect(body).not.toHaveProperty("exists");
        expect(JSON.stringify(body)).not.toContain("Synthetic");
      } finally {
        console.error = originalError;
      }
    });
  }

  test("POST preserves the retryable 503 and its Retry-After header", async () => {
    returnedError = { code: "08006", message: "Synthetic connection failure" };
    const originalError = console.error;
    console.error = () => {};

    try {
      const response = await POST(request({ expectedData }), params);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("5");
      expect(body).toMatchObject({ valid: false, retryable: true });
      expect(body).not.toHaveProperty("exists");
      expect(body).not.toHaveProperty("verification");
    } finally {
      console.error = originalError;
    }
  });

  for (const code of ["PGRST116", "42501"]) {
    test(`a missing or unreadable certificate (${code}) stays a private 404`, async () => {
      returnedError = { code, message: "Synthetic refusal" };

      const response = await GET(request(), params);

      expect(response.status).toBe(404);
      expect(response.headers.get("Retry-After")).toBeNull();
      expect(await response.json()).toEqual({
        error: "Certificate not found",
        valid: false,
        exists: false,
      });
    });
  }

  test("an empty result without an error stays a private 404", async () => {
    missing = true;

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ exists: false });
  });
  test("invalid stored dates never compare as zero valid hours", async () => {
    malformedDates = true;
    const response = await POST(
      request({ expectedData: { ...expectedData, duration: 0 } }),
      params,
    );
    const body = await response.json();
    expect(body.event.duration).toBeNull();
    expect(body.verification.matches.hours).toBe(false);
  });
  test("malformed JSON and invalid comparison inputs return 400", async () => {
    for (const duration of ["1.3garbage", "Infinity", -1, {}, ""]) {
      expect(
        (
          await POST(
            request({ expectedData: { ...expectedData, duration } }),
            params,
          )
        ).status,
      ).toBe(400);
    }
    const malformed = new NextRequest("http://localhost", {
      method: "POST",
      body: "broken-json",
    });
    expect((await POST(malformed, params)).status).toBe(400);
  });
  test("POST without comparison data keeps the GET verification contract", async () => {
    const response = await POST(request({}), params);
    expect(response.status).toBe(200);
    expect((await response.json()).event.duration).toBe(1.3);
  });
});
