import { beforeEach, expect, mock, test } from "bun:test";
import type { Project } from "@/types";
import { getPublishStateKey } from "@/lib/projects/hours-publish-key";

const projectId = "fictional-project";
let project: Pick<Project, "event_type" | "schedule"> & {
  id: string;
  creator_id: string;
  organization_id: null;
  title: string;
  project_timezone: string;
};
type Certificate = {
  id: string;
  project_id: string;
  schedule_id: string;
  volunteer_name: string;
  volunteer_email: string;
};
let certificates: Certificate[] = [];
let sent: string[] = [];
let certificateReads = 0;
let durable = false;
let durableKey = "";
const client = {
  auth: { getUser: async () => ({ data: { user: { id: "organizer" } } }) },
  from: (table: string) => {
    const filters: Array<(row: Certificate) => boolean> = [];
    const query = {
      select: () => query,
      eq: (field: keyof Certificate, value: string) => {
        filters.push((row) => row[field] === value);
        return query;
      },
      in: (field: keyof Certificate, values: string[]) => {
        filters.push((row) => values.includes(row[field]));
        return query;
      },
      single: async () => {
        expect(table).toBe("projects");
        return { data: project, error: null };
      },
      then: (
        resolve: (result: { data: Certificate[]; error: null }) => unknown,
      ) => {
        expect(table).toBe("certificates");
        certificateReads++;
        return resolve({
          data: certificates.filter((row) =>
            filters.every((filter) => filter(row)),
          ),
          error: null,
        });
      },
    };
    return query;
  },
};
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => ({}) }));
mock.module("@/lib/logger", () => ({
  logError() {},
  logInfo() {},
  logWarn() {},
}));
mock.module("@/lib/projects/hours-publication-service", () => ({
  publishVolunteerHoursTransaction() {},
  requestCorrectedCertificateDelivery() {},
}));
mock.module("@/lib/projects/hours-publication-email-service", () => ({
  loadDurablePublicationForRetry: async (
    _client: unknown,
    input: { publishKey: string },
  ) => {
    durableKey = input.publishKey;
    return durable ? { id: "receipt" } : null;
  },
  drainPublicationEmails: async () => ({ emailsSent: 7, errors: [] }),
}));
mock.module("./certificate-issuance", () => ({
  getPublishStateKey,
  sendCertificatePublishedEmails: async (rows: Certificate[]) => {
    sent = rows.map((row) => row.id);
    return { emailsSent: rows.length, errors: [] };
  },
}));
const { resendCertificateEmails } = await import("./actions");
const slot = { startTime: "09:00", endTime: "11:00", volunteers: 10 };
beforeEach(() => {
  project = {
    id: projectId,
    creator_id: "organizer",
    organization_id: null,
    title: "Fictional project",
    project_timezone: "UTC",
    event_type: "oneTime",
    schedule: { oneTime: { date: "2020-09-18", ...slot } },
  };
  certificates = [];
  sent = [];
  certificateReads = 0;
  durable = false;
  durableKey = "";
});
const cases: Array<{
  event_type: Project["event_type"];
  schedule: Project["schedule"];
  aliases: string[];
}> = [
  {
    event_type: "oneTime",
    schedule: { oneTime: { date: "2020-09-18", ...slot } },
    aliases: ["oneTime", "0", "default"],
  },
  {
    event_type: "multiDay",
    schedule: { multiDay: [{ date: "2020-09-18", slots: [slot, slot] }] },
    aliases: ["2020-09-18-0-0", "2020-09-18-0", "0-0", "day-0-slot-0"],
  },
  {
    event_type: "sameDayMultiArea",
    schedule: {
      sameDayMultiArea: {
        date: "2020-09-18",
        overallStart: "09:00",
        overallEnd: "11:00",
        roles: [
          { name: "Setup", ...slot },
          { name: "Cleanup", ...slot },
        ],
      },
    },
    aliases: ["Setup", "role-0"],
  },
];
for (const fixture of cases) {
  test(`legacy resend includes every ${fixture.event_type} alias within the authorized project`, async () => {
    Object.assign(project, {
      event_type: fixture.event_type,
      schedule: fixture.schedule,
    });
    certificates = [...fixture.aliases, "unrelated-session"].map(
      (alias, index) => ({
        id: `certificate-${index}`,
        project_id: projectId,
        schedule_id: alias,
        volunteer_name: "Fictional Volunteer",
        volunteer_email: "volunteer@example.test",
      }),
    );
    certificates.push({
      ...certificates[0],
      id: "other-project",
      project_id: "another-project",
    });
    const result = await resendCertificateEmails(
      projectId,
      fixture.aliases.at(-1)!,
    );
    expect(result.success).toBe(true);
    expect(result.deliveryMode).toBe("manual-resend");
    expect(sent).toEqual(
      fixture.aliases.map((_, index) => `certificate-${index}`),
    );
  });
}
test("durable retries retain the canonical ledger and skip the legacy send", async () => {
  durable = true;
  const result = await resendCertificateEmails(projectId, "default");
  expect(result.deliveryMode).toBe("durable-retry");
  expect(durableKey).toBe("oneTime");
  expect(certificateReads).toBe(0);
  expect(sent).toEqual([]);
});
test("unknown sessions cannot read or resend certificates", async () => {
  const result = await resendCertificateEmails(projectId, "unknown");
  expect(result.success).toBe(false);
  expect(certificateReads).toBe(0);
  expect(durableKey).toBe("unknown");
});
test("removed sessions can still retry their authorized durable publication", async () => {
  durable = true;
  const result = await resendCertificateEmails(projectId, "Removed role");
  expect(result.deliveryMode).toBe("durable-retry");
  expect(durableKey).toBe("Removed role");
  expect(certificateReads).toBe(0);
  expect(sent).toEqual([]);
});
test("unauthorized users cannot read or resend certificates", async () => {
  project.creator_id = "another-organizer";
  const result = await resendCertificateEmails(projectId, "oneTime");
  expect(result.success).toBe(false);
  expect(certificateReads).toBe(0);
  expect(durableKey).toBe("");
});
