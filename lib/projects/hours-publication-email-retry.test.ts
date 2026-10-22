import { beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("react-email", () => ({ render: async () => "<p>fictional</p>" }));
mock.module("@/emails/certificate-published", () => ({ default: () => null }));
mock.module("@/services/email", () => ({
  sendEmail: () => {
    throw new Error("Provider dispatch is forbidden in this read test");
  },
}));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => {
    throw new Error("Only the supplied synthetic client may be used");
  },
}));
const { loadDurablePublicationForRetry } =
  await import("./hours-publication-email-service");

type Row = Record<string, unknown>;
let outbox: Row[] = [];
let certificates: Row[] = [];
const operations: Array<{
  relation: string;
  methods: Array<[string, ...unknown[]]>;
}> = [];
beforeEach(() => {
  outbox = [];
  certificates = [];
  operations.length = 0;
});
function client() {
  return {
    from(relation: string) {
      const methods: Array<[string, ...unknown[]]> = [];
      operations.push({ relation, methods });
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "eq",
        "in",
        "order",
        "gt",
        "range",
        "limit",
      ]) {
        chain[method] = (...args: unknown[]) => {
          methods.push([method, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = async () => ({
        data: {
          id: "fictional-receipt",
          request_key: "fictional-request",
          certificate_count: outbox.length,
          publication_origin: "automatic",
        },
        error: null,
      });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        let selected = [
          ...(relation === "certificates" ? certificates : outbox),
        ];
        for (const [method, field, value] of methods) {
          if (method === "gt")
            selected = selected.filter(
              (row) => String(row[String(field)]) > String(value),
            );
          if (method === "in") {
            const wanted = new Set(value as unknown[]);
            selected = selected.filter((row) => wanted.has(row[String(field)]));
          }
          if (method === "order")
            selected.sort((a, b) =>
              String(a[String(field)]).localeCompare(String(b[String(field)])),
            );
          if (method === "range")
            selected = selected.slice(Number(field), Number(value) + 1);
          if (method === "limit") selected = selected.slice(0, Number(field));
        }
        return Promise.resolve({
          data: selected.slice(0, 1000),
          error: null,
        }).then(resolve, reject);
      };
      return chain;
    },
  };
}
function fixtures(count: number) {
  for (let index = 0; index < count; index++) {
    const suffix = String(index).padStart(5, "0");
    outbox.push({
      id: `delivery-${suffix}`,
      state: "queued",
      idempotency_key: `immutable-${suffix}`,
      certificate_id: `certificate-${suffix}`,
      payload_prepared_at: null,
    });
    certificates.push({
      id: `certificate-${suffix}`,
      volunteer_name: "Fictional Volunteer",
      volunteer_email: "fictional@example.test",
      event_start: "2026-01-01T10:00:00Z",
      event_end: "2026-01-01T11:00:00Z",
      credited_minutes: 60,
      attendance_revision: 1,
    });
  }
}

test("durable retry reads every one of 1001 deliveries across stable bounded pages", async () => {
  fixtures(1001);
  const publication = await loadDurablePublicationForRetry(client() as never, {
    projectId: "fictional-project",
    publishKey: "oneTime",
    projectTitle: "Fictional cleanup",
    projectTimezone: "UTC",
  });
  expect(publication?.deliveries).toHaveLength(1001);
  expect(
    new Set(publication!.deliveries.map((row) => row.deliveryId)).size,
  ).toBe(1001);
  const reads = operations.filter(
    (op) => op.relation === "hours_publication_email_outbox",
  );
  expect(reads.length).toBeGreaterThan(1);
  expect(
    reads.every((op) =>
      op.methods.some(
        ([method, field]) => method === "order" && field === "id",
      ),
    ),
  ).toBe(true);
});

const retryInput = {
  projectId: "fictional-project",
  publishKey: "oneTime",
  projectTitle: "Fictional cleanup",
  projectTimezone: "UTC",
};

test("a ledger that ends exactly on a page boundary is read once and completely", async () => {
  fixtures(1000);
  const publication = await loadDurablePublicationForRetry(
    client() as never,
    retryInput,
  );
  expect(publication!.deliveries.map((row) => row.deliveryId)).toEqual(
    outbox.map((row) => row.id as string),
  );
  const reads = operations.filter(
    (op) => op.relation === "hours_publication_email_outbox",
  );
  // Two full pages, then the empty page that proves the end.
  expect(reads).toHaveLength(3);
  expect(
    reads.map((op) => op.methods.find(([method]) => method === "gt")?.[2]),
  ).toEqual([undefined, "delivery-00499", "delivery-00999"]);
  expect(
    reads.every((op) =>
      op.methods.some(([method, size]) => method === "limit" && size === 500),
    ),
  ).toBe(true);
});

test("an empty ledger returns the receipt without any certificate read", async () => {
  const publication = await loadDurablePublicationForRetry(
    client() as never,
    retryInput,
  );
  expect(publication).toMatchObject({
    outcome: "replayed",
    receiptId: "fictional-receipt",
    publicationOrigin: "automatic",
    deliveries: [],
  });
  expect(operations.some((op) => op.relation === "certificates")).toBe(false);
});

test("a ledger above the safe ceiling fails closed instead of returning a partial retry", async () => {
  fixtures(10_001);
  await expect(
    loadDurablePublicationForRetry(client() as never, retryInput),
  ).rejects.toThrow("durable publication delivery ledger exceeds the limit");
});

test("retry retains immutable delivery keys and attendance revisions over a page boundary", async () => {
  fixtures(1001);
  const publication = await loadDurablePublicationForRetry(client() as never, {
    projectId: "fictional-project",
    publishKey: "oneTime",
    projectTitle: "Fictional cleanup",
    projectTimezone: "UTC",
  });
  expect(publication!.deliveries.at(-1)).toMatchObject({
    deliveryId: "delivery-01000",
    certificateId: "certificate-01000",
    idempotencyKey: "immutable-01000",
    attendanceRevision: 1,
  });
  const certificateReads = operations.filter(
    (op) => op.relation === "certificates",
  );
  expect(certificateReads.length).toBeGreaterThan(1);
  expect(
    certificateReads.every((op) =>
      op.methods
        .filter(([method]) => method === "in")
        .every(([, , values]) => (values as unknown[]).length <= 500),
    ),
  ).toBe(true);
});
