// Execute the server page in isolation so admin-client mocks stay local.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { isValidElement } from "react";
import type { PrintCertificateData } from "./_components/PrintCertificate";

const scenario = process.argv[2];
const privateValues = {
  user_id: "private-user-id",
  signup_id: "private-signup-id",
  schedule_id: "private-session-id",
  volunteer_email: "private-volunteer@example.test",
  access_token: "private-guest-access-token",
  extra_private: { recovery_token: "future-private-field" },
};
const record = {
  id: "c8200000-0000-4000-8000-000000000001",
  project_title: "Historical project title",
  creator_name: "Fictional Coordinator",
  creator_username: "fictional-coordinator",
  is_certified: true,
  type: scenario === "self-reported" ? "self-reported" : null,
  event_start: "2020-09-18T09:00:00Z",
  event_end: "2020-09-18T12:00:00Z",
  credited_minutes: scenario === "legacy" ? null : 95,
  check_in_method: "manual",
  created_at: "2020-09-18T12:05:00Z",
  organization_name: "Historical organization snapshot",
  project_id: "public-project-id",
  issued_at: "2020-09-18T12:05:00Z",
  volunteer_name: "Fictional Volunteer",
  project_location: "Historical location",
  description: "Fictional self-reported activity",
  ...privateValues,
};
const selections: string[] = [];
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      assert.equal(table, "certificate_verification_read_model");
      const query = {
        select: (columns: string) => {
          selections.push(columns);
          return query;
        },
        eq: (column: string, value: string) => {
          assert.equal(column, "id");
          assert.equal(value, record.id);
          return query;
        },
        // Extra fields model a future read-model expansion. The page must still
        // pass only explicit display fields to every client component.
        single: async () => ({ data: record, error: null }),
      };
      return query;
    },
  }),
}));
function PrintBoundary() {
  return null;
}
mock.module("./_components/PrintCertificate", () => ({
  PrintCertificate: PrintBoundary,
}));
const { default: Page, generateMetadata } = await import("./page");
const params = Promise.resolve({ id: record.id });
const tree = await Page({ params });
const printProps: Array<{ data: PrintCertificateData }> = [];
function visit(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === PrintBoundary)
    printProps.push(element.props as { data: PrintCertificateData });
  if (element.props) Object.values(element.props).forEach(visit);
}
visit(tree);
assert.equal(printProps.length, 1);
assert.deepEqual(printProps[0].data, {
  id: record.id,
  project_title: record.project_title,
  creator_name: record.creator_name,
  is_certified: record.is_certified,
  event_start: record.event_start,
  organization_name: record.organization_name,
  issued_at: record.issued_at,
  volunteer_name: record.volunteer_name,
  project_location: record.project_location,
  durationText: scenario === "legacy" ? "3 hours" : "1 hour 35 mins",
});
// Component implementations and React owner metadata are not page props.
const serialized = JSON.stringify(tree, (_key, value) =>
  isValidElement(value) ? { props: value.props } : value,
);
for (const [key, value] of Object.entries(privateValues)) {
  assert.ok(
    !serialized.includes(`"${key}"`),
    `Private key crossed the public page boundary: ${key}`,
  );
  assert.ok(
    !serialized.includes(
      typeof value === "string" ? value : value.recovery_token,
    ),
  );
}
assert.ok(
  serialized.includes(record.id),
  "The public certificate identity and URL stay stable",
);
assert.ok(serialized.includes(record.volunteer_name));
assert.ok(serialized.includes(record.organization_name));
assert.ok(serialized.includes(record.project_title));
assert.ok(
  serialized.includes(
    scenario === "self-reported" ? record.description : record.project_id,
  ),
);
const metadata = await generateMetadata({ params });
assert.equal(metadata.title, `${record.project_title} Volunteer Certificate`);
for (const columns of selections) {
  for (const field of Object.keys(privateValues))
    assert.ok(
      !columns
        .split(",")
        .map((part) => part.trim())
        .includes(field),
    );
}
