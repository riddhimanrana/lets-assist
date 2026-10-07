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
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (failed) throw new Error("Synthetic read failure");
            return {
              data: missing
                ? null
                : {
                    ...certificate,
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
  });
  test("GET includes numeric duration matching the exported one-decimal hours", async () => {
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect((await response.json()).event.duration).toBe(1.3);
  });
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
    expect(await response.json()).toMatchObject({ valid: false });
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
