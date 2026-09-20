// Run in a child process so provider mocks cannot leak into other unit suites.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import type {
  PaperSignupExtraction,
  PaperSignupRow,
} from "@/lib/ai/paper-signup-schema";

const batchId = "c3000000-0000-4000-8000-000000000001";
const projectId = "c3000000-0000-4000-8000-000000000002";
const userId = "c3000000-0000-4000-8000-000000000003";
type Stored = Record<string, unknown>;
const batch: Stored = {
  id: batchId,
  project_id: projectId,
  schedule_id: "oneTime",
  status: "draft",
  updated_at: "2026-09-20T00:00:00Z",
  extraction_claim_id: null,
  projects: {
    id: projectId,
    creator_id: userId,
    organization_id: null,
    can_be_managed_by_staff: false,
    title: "Fictional attendance test",
    project_timezone: "America/Los_Angeles",
    event_type: "oneTime",
    schedule: {
      oneTime: { date: "2026-09-20", startTime: "09:00", endTime: "12:00" },
    },
  },
};
const tables: Record<string, Stored[]> = {
  project_paper_scan_batches: [batch],
  project_paper_scan_rows: [],
  project_paper_scan_images: [],
  project_signups: [],
  anonymous_signups: [],
};
const writes: Array<{ table: string; operation: string }> = [];
const outputs = new Map<string, PaperSignupExtraction | Error>();
const missingPhotos = new Set<string>();
const downloads: string[] = [];
const aiCalls: string[] = [];
let failReviewSettlement = false;

class Query {
  private operation = "select";
  private values: Stored | Stored[] = {};
  private filters: Array<(row: Stored) => boolean> = [];
  constructor(private table: string) {
    assert.ok(table in tables, `Unexpected table: ${table}`);
  }
  select() {
    return this;
  }
  order() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  update(values: Stored) {
    this.operation = "update";
    this.values = values;
    return this;
  }
  insert(values: Stored[]) {
    this.operation = "insert";
    this.values = values;
    return this;
  }
  delete() {
    this.operation = "delete";
    return this;
  }
  private execute(single = false) {
    const matching = tables[this.table].filter((row) =>
      this.filters.every((filter) => filter(row)),
    );
    if (this.operation !== "select") {
      assert.ok(
        ["project_paper_scan_batches", "project_paper_scan_rows"].includes(
          this.table,
        ),
        "Extraction must never write attendance or credit",
      );
      writes.push({ table: this.table, operation: this.operation });
    }
    if (this.operation === "update") {
      if (failReviewSettlement && (this.values as Stored).status === "review") {
        failReviewSettlement = false;
        return { data: null, error: { code: "fictional_lost_settlement" } };
      }
      for (const row of matching) Object.assign(row, this.values);
    } else if (this.operation === "delete") {
      tables[this.table] = tables[this.table].filter(
        (row) => !matching.includes(row),
      );
    } else if (this.operation === "insert") {
      tables[this.table].push(...structuredClone(this.values as Stored[]));
    }
    return {
      data: structuredClone(single ? (matching[0] ?? null) : matching),
      error: null,
    };
  }
  single() {
    return Promise.resolve(this.execute(true));
  }
  maybeSingle() {
    return Promise.resolve(this.execute(true));
  }
  then(resolve: (result: ReturnType<Query["execute"]>) => unknown) {
    return Promise.resolve(this.execute()).then(resolve);
  }
}
const admin = {
  from: (table: string) => new Query(table),
  rpc: () => {
    throw new Error("Extraction must not publish or commit attendance");
  },
  storage: {
    from: (bucket: string) => {
      assert.equal(bucket, "paper-signup-scans");
      return {
        download: async (path: string) => {
          downloads.push(path);
          return missingPhotos.has(path)
            ? { data: null, error: { code: "unreadable" } }
            : { data: new Blob([path]), error: null };
        },
      };
    },
  },
};
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => admin }));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: userId }, error: null }),
}));
mock.module("@/lib/ai/rate-limit", () => ({
  consumeAiQuota: async () => ({ allowed: true }),
}));
mock.module("@/lib/ai/models", () => ({
  AI_MODEL_FALLBACK_CHAIN: ["fictional-cheap", "fictional-fallback"],
}));
mock.module("@/lib/ai/with-ai-tracking", () => ({
  prepareTrackedAiCall: () => ({ model: {}, logUsage: async () => {} }),
}));
mock.module("@/lib/attendance/print-manifest", () => ({
  resolveAttendancePrintReference: async () => null,
}));
mock.module("ai", () => ({
  Output: { object: () => ({}) },
  generateText: async (options: {
    messages: Array<{ content: Array<{ data?: Uint8Array }> }>;
  }) => {
    const bytes = options.messages[0].content[1].data;
    const path = new TextDecoder().decode(bytes);
    aiCalls.push(path);
    const output = outputs.get(path);
    if (output instanceof Error) throw output;
    assert.ok(output, `No fictional extraction for ${path}`);
    return { output, usage: { inputTokens: 1, outputTokens: 1 } };
  },
}));
const { POST } = await import("./route");
const field = (value: string | null) => ({ value, confidence: 1 });
function row(
  timeIn: string | null = "09:15",
  timeOut: string | null = "11:45",
): PaperSignupRow {
  return {
    sheetRowNumber: 7,
    name: field("Fictional Volunteer"),
    email: field("scan-volunteer@example.test"),
    phone: field(null),
    timeIn: field(timeIn),
    timeOut: field(timeOut),
    intervals: [{ timeIn: field(timeIn), timeOut: field(timeOut) }],
    signaturePresent: false,
    rowConfidence: 1,
    notes: "Original handwritten transcription",
  };
}
function extraction(
  rows: PaperSignupRow[],
  sheetLegible = true,
): PaperSignupExtraction {
  return {
    sheetLegible,
    detectedColumns: ["Name", "Email", "In", "Out"],
    rows,
  };
}
function photo(sequence: number, output: PaperSignupExtraction | Error) {
  const image = {
    id: `photo-${sequence}`,
    batch_id: batchId,
    object_path: `${projectId}/${batchId}/photo-${sequence}.jpg`,
    content_type: "image/jpeg",
    sequence,
  };
  tables.project_paper_scan_images.push(image);
  outputs.set(image.object_path, output);
  return image;
}
async function scan() {
  return POST(
    new NextRequest("http://localhost/api/ai/scan-signup-sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId }),
    }),
  );
}
function assertNoCredit() {
  assert.deepEqual(tables.project_signups, []);
  assert.deepEqual(tables.anonymous_signups, []);
  assert.ok(
    writes.every((write) =>
      ["project_paper_scan_batches", "project_paper_scan_rows"].includes(
        write.table,
      ),
    ),
  );
  for (const staged of tables.project_paper_scan_rows) {
    assert.equal(staged.review_acknowledged, false);
    assert.equal(staged.identity_confirmed, false);
    assert.equal(staged.committed_signup_id, undefined);
  }
}

const scenario = process.argv[2];
if (scenario === "unreadable") {
  const image = photo(1, extraction([], false));
  const originalImages = structuredClone(tables.project_paper_scan_images);
  const response = await scan();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /readable attendance rows/i);
  assert.equal(batch.status, "failed");
  assert.equal(batch.extraction_claim_id, null);
  assert.equal(tables.project_paper_scan_rows.length, 0);
  assert.equal(
    aiCalls.length,
    2,
    "Unreadable extraction must try the fallback",
  );
  assert.deepEqual(tables.project_paper_scan_images, originalImages);
  assertNoCredit();
  outputs.set(image.object_path, extraction([row()]));
  assert.equal(
    (await scan()).status,
    200,
    "Failed scan can be retried without reupload",
  );
  assert.equal(batch.status, "review");
  assert.equal(tables.project_paper_scan_rows.length, 1);
  assert.equal(tables.project_paper_scan_rows[0].image_id, image.id);
  assertNoCredit();
} else if (scenario === "blank-sheet") {
  photo(1, extraction([]));
  const response = await scan();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /No readable attendance rows/);
  assert.equal(batch.status, "failed");
  assert.equal(batch.extraction_error, "no_readable_attendance_rows");
  assert.equal(tables.project_paper_scan_images.length, 1);
  assert.equal(tables.project_paper_scan_rows.length, 0);
  assertNoCredit();
} else if (scenario === "repeated-visits") {
  const original = row();
  original.intervals = [
    { timeIn: field("09:15 AM"), timeOut: field("10:05 AM") },
    { timeIn: field("10:30 AM"), timeOut: field("11:45 AM") },
    { timeIn: field("11:50"), timeOut: field(null) },
  ];
  photo(1, extraction([original]));
  assert.equal((await scan()).status, 200);
  const staged = tables.project_paper_scan_rows[0];
  assert.deepEqual(staged.raw_extraction, original);
  assert.deepEqual(staged.attendance_intervals, [
    {
      checkIn: "2026-09-20T16:15:00.000Z",
      checkOut: "2026-09-20T17:05:00.000Z",
    },
    {
      checkIn: "2026-09-20T17:30:00.000Z",
      checkOut: "2026-09-20T18:45:00.000Z",
    },
    { checkIn: null, checkOut: null },
  ]);
  assertNoCredit();
} else if (scenario === "provider-failure") {
  photo(1, new Error("Fictional provider failure"));
  assert.equal((await scan()).status, 422);
  assert.equal(batch.status, "failed");
  assert.equal(batch.extraction_error, "no_images_extracted");
  assert.equal(tables.project_paper_scan_images.length, 1);
  assert.equal(tables.project_paper_scan_rows.length, 0);
  assertNoCredit();
} else if (scenario === "duplicate") {
  const original = row();
  photo(1, extraction([original]));
  photo(2, extraction([original]));
  assert.equal((await scan()).status, 200);
  assert.equal(
    tables.project_paper_scan_rows.length,
    2,
    "Keep both sources for explicit review",
  );
  assert.equal(tables.project_paper_scan_rows[1].decision, "pending");
  assert.equal(
    tables.project_paper_scan_rows[1].outcome_detail,
    "duplicate_of_row_1",
  );
  const saved = structuredClone(tables.project_paper_scan_rows);
  const calls = aiCalls.length;
  assert.equal(
    (await scan()).status,
    409,
    "Reused extracted batch must not stage duplicates",
  );
  assert.deepEqual(tables.project_paper_scan_rows, saved);
  assert.equal(aiCalls.length, calls);
  assertNoCredit();
} else if (scenario === "extraction-lease") {
  photo(1, extraction([row()]));
  batch.status = "extracting";
  batch.updated_at = new Date().toISOString();
  tables.project_paper_scan_rows.push({ batch_id: batchId, partial: true });
  assert.equal((await scan()).status, 409);
  assert.equal(aiCalls.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(tables.project_paper_scan_rows.length, 1);
  batch.updated_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  assert.equal((await scan()).status, 200);
  assert.equal(tables.project_paper_scan_rows.length, 1);
  assert.equal(tables.project_paper_scan_rows[0].partial, undefined);
  assert.equal(batch.status, "review");
  assertNoCredit();
} else if (scenario === "partial-retry") {
  photo(1, extraction([row()]));
  failReviewSettlement = true;
  assert.equal((await scan()).status, 500);
  assert.equal(batch.status, "failed");
  assert.equal(
    tables.project_paper_scan_rows.length,
    1,
    "Staging completed before settlement failed",
  );
  assert.equal((await scan()).status, 200);
  assert.equal(batch.status, "review");
  assert.equal(
    tables.project_paper_scan_rows.length,
    1,
    "Retry replaces partial staging instead of appending",
  );
  assert.equal(
    writes.filter((write) => write.operation === "delete").length,
    2,
  );
  assertNoCredit();
} else if (scenario === "separate-pages") {
  const incoming = row("09:17", null);
  const outgoing = row(null, "11:42 AM");
  const first = photo(1, extraction([incoming]));
  const second = photo(2, extraction([outgoing]));
  assert.equal((await scan()).status, 200);
  const [inRow, outRow] = tables.project_paper_scan_rows;
  assert.deepEqual(inRow.raw_extraction, incoming);
  assert.deepEqual(outRow.raw_extraction, outgoing);
  assert.equal(inRow.image_id, first.id);
  assert.equal(outRow.image_id, second.id);
  assert.deepEqual(downloads, [first.object_path, second.object_path]);
  assert.deepEqual(inRow.attendance_intervals, [
    { checkIn: "2026-09-20T16:17:00.000Z", checkOut: null },
  ]);
  assert.deepEqual(outRow.attendance_intervals, [
    { checkIn: null, checkOut: "2026-09-20T18:42:00.000Z" },
  ]);
  assert.equal(outRow.outcome_detail, "duplicate_of_row_1");
  assert.equal(outRow.decision, "pending");
  assertNoCredit();
} else if (scenario === "partial-photo") {
  const first = photo(1, extraction([row()]));
  const second = photo(2, extraction([], false));
  missingPhotos.add(second.object_path);
  const response = await scan();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).warnings, ["image_2_unreadable"]);
  assert.equal(batch.status, "review");
  assert.equal(tables.project_paper_scan_rows.length, 1);
  assert.equal(tables.project_paper_scan_rows[0].image_id, first.id);
  assert.equal(tables.project_paper_scan_images.length, 2);
  assertNoCredit();
} else {
  throw new Error(`Unknown scenario: ${scenario}`);
}
