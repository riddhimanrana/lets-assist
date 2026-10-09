import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { classifyWorkerResponse } from "@/lib/cron/worker-outcome";
import type { OccurrenceWaiverFailureCode } from "@/lib/waiver/occurrence-waiver";

import { processRecurringProjects } from "./recurring-project-worker";

type Row = Record<string, unknown> & { id: string };
type QueryError = { code?: string; message: string };
type QueryResult = { data: unknown; error: QueryError | null };

const BUCKET = "waiver-uploads";
const CREATOR_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_DEFINITION_ID = "44444444-4444-4444-8444-444444444444";
const PARENT_PDF = `project_waivers/${PARENT_ID}/1700000000000_waiver.pdf`;

const SIGNERS = [
  {
    role_key: "volunteer",
    label: "Volunteer",
    required: true,
    order_index: 0,
    rules: null,
  },
];
const FIELDS = [
  {
    field_key: "volunteer-signature",
    field_type: "signature",
    label: "Signature",
    source: "custom_overlay",
    page_index: 0,
    rect: { x: 40, y: 600, width: 180, height: 50 },
    required: true,
    signer_role_key: "volunteer",
    pdf_field_name: null,
    meta: null,
  },
];

/** A thenable query over one in-memory table, in the worker's own dialect. */
class Query {
  private operation: "select" | "insert" | "update" = "select";
  private payload: Record<string, unknown> = {};
  private readonly equals = new Map<string, unknown>();
  private readonly isNull = new Set<string>();
  private readonly notFilters: Array<[string, string, unknown]> = [];
  private readonly jsonFilters: Array<[string, string]> = [];
  private readonly orders: Array<[string, boolean]> = [];
  private readonly greaterThan: Array<[string, string]> = [];
  private readonly anyOf: string[][] = [];
  private rowLimit: number | null = null;

  constructor(
    private readonly database: InMemoryDatabase,
    private readonly table: "projects" | "waiver_definitions",
  ) {}

  select() {
    return this;
  }
  insert(payload: Record<string, unknown>) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }
  eq(column: string, value: unknown) {
    this.equals.set(column, value);
    return this;
  }
  is(column: string, value: unknown) {
    if (value === null) this.isNull.add(column);
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    this.notFilters.push([column, operator, value]);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push([column, options?.ascending !== false]);
    return this;
  }
  limit(value: number) {
    this.rowLimit = value;
    return this;
  }
  gt(column: string, value: string) {
    this.greaterThan.push([column, value]);
    return this;
  }
  /** PostgREST `or`: a row passes when any `column.operator.value` holds. */
  or(conditions: string) {
    this.anyOf.push(conditions.split(","));
    return this;
  }
  filter(path: string, _operator: string, value: string) {
    this.jsonFilters.push([path, value]);
    return this;
  }

  private rows(): Row[] {
    return this.table === "projects"
      ? this.database.projects
      : this.database.definitions;
  }

  private matching(): Row[] {
    let rows = this.rows().filter((row) => {
      for (const [column, value] of this.equals) {
        if (row[column] !== value) return false;
      }
      for (const column of this.isNull) {
        if (row[column] !== null && row[column] !== undefined) return false;
      }
      for (const [column, operator, value] of this.notFilters) {
        const present = row[column] !== null && row[column] !== undefined;
        if (operator === "is" && value === null && !present) return false;
        if (operator === "eq" && row[column] === value) return false;
      }
      for (const [column, value] of this.greaterThan) {
        // As in SQL, a null never compares greater than anything.
        const present = row[column] !== null && row[column] !== undefined;
        if (!present || String(row[column]) <= value) return false;
      }
      for (const conditions of this.anyOf) {
        const passes = conditions.some((condition) => {
          const [column, operator, value] = condition.split(".");
          const present = row[column] !== null && row[column] !== undefined;
          if (operator === "is" && value === "null") return !present;
          if (operator === "neq") return present && row[column] !== value;
          throw new Error(`Unexpected or-condition: ${condition}`);
        });
        if (!passes) return false;
      }
      for (const [path, value] of this.jsonFilters) {
        const eventType = path.includes("oneTime")
          ? "oneTime"
          : "sameDayMultiArea";
        const schedule = row.schedule as Record<string, { date?: string }>;
        if (schedule?.[eventType]?.date !== value) return false;
      }
      return true;
    });

    for (const [column, ascending] of [...this.orders].reverse()) {
      rows = rows.toSorted((left, right) => {
        const comparison = String(left[column] ?? "").localeCompare(
          String(right[column] ?? ""),
        );
        return ascending ? comparison : -comparison;
      });
    }

    return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
  }

  private run(): { rows: Row[]; error: QueryError | null } {
    if (this.operation === "insert") {
      if (this.database.failures.insert) {
        return { rows: [], error: { code: "42501", message: "denied" } };
      }
      const duplicate = this.database.projects.some(
        (row) =>
          row.recurrence_parent_id === this.payload.recurrence_parent_id &&
          row.recurrence_occurrence_date ===
            this.payload.recurrence_occurrence_date,
      );
      if (duplicate) {
        return { rows: [], error: { code: "23505", message: "duplicate" } };
      }
      const row = { recurrence_rule: null, ...this.payload, id: randomUUID() };
      this.database.insertPayloads.push({ ...this.payload });
      this.database.projects.push(row);
      this.database.inserted.push(row);
      return { rows: [row], error: null };
    }

    if (this.operation === "update") {
      if (this.database.failures.attach) {
        return { rows: [], error: { code: "42501", message: "denied" } };
      }
      const rows = this.matching();
      for (const row of rows) Object.assign(row, this.payload);
      return { rows, error: null };
    }

    return { rows: this.matching(), error: null };
  }

  private one(allowEmpty: boolean): QueryResult {
    const { rows, error } = this.run();
    if (error) return { data: null, error };
    if (rows.length === 1) return { data: rows[0], error: null };
    return rows.length === 0 && allowEmpty
      ? { data: null, error: null }
      : { data: null, error: { code: "PGRST116", message: "row count" } };
  }

  maybeSingle() {
    return Promise.resolve(this.one(true));
  }
  single() {
    return Promise.resolve(this.one(false));
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const { rows, error } = this.run();
    return Promise.resolve({ data: error ? null : rows, error }).then(
      onfulfilled,
      onrejected,
    );
  }
}

/**
 * Projects, waiver definitions, the waiver bucket and the three database
 * functions the worker calls. The publication function applies the same
 * checks as `private.waiver_publication_blocker`.
 */
class InMemoryDatabase {
  readonly inserted: Row[] = [];
  /** What each insert wrote, before any later step touched the row. */
  readonly insertPayloads: Record<string, unknown>[] = [];
  readonly definitions: Row[] = [];
  readonly objects = new Set<string>();
  readonly copies: Array<{ bucket: string; from: string; to: string }> = [];
  readonly deletionQueue: string[] = [];
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  readonly failures = {
    insert: false,
    copy: false,
    /** The copy call reports success but no object is stored. */
    copyStoresNothing: false,
    attach: false,
    definition: false,
  };

  constructor(readonly projects: Row[]) {}

  from(table: string) {
    if (table !== "projects" && table !== "waiver_definitions") {
      throw new Error(`Unexpected table: ${table}`);
    }
    return new Query(this, table);
  }

  readonly storage = {
    from: (bucket: string) => ({
      copy: async (from: string, to: string) => {
        this.copies.push({ bucket, from, to });
        if (this.failures.copy || !this.objects.has(from)) {
          return { data: null, error: { message: "copy failed" } };
        }
        if (!this.failures.copyStoresNothing) this.objects.add(to);
        return { data: { path: to }, error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://storage.test/public/${bucket}/${path}` },
      }),
    }),
  };

  async rpc(name: string, args: Record<string, unknown>): Promise<QueryResult> {
    this.rpcCalls.push({ name, args });
    const project = this.projects.find((row) => row.id === args.p_project_id);

    if (name === "enqueue_superseded_waiver_source") {
      const path = String(args.p_object_path);
      const referenced =
        this.projects.some((row) => row.waiver_pdf_storage_path === path) ||
        this.definitions.some((row) => row.pdf_storage_path === path);
      if (!referenced) this.deletionQueue.push(path);
      return { data: !referenced, error: null };
    }

    if (name === "save_project_waiver_definition_version") {
      if (this.failures.definition || !project) {
        return { data: null, error: { code: "22023", message: "refused" } };
      }
      for (const definition of this.definitions) {
        if (definition.project_id === project.id) definition.active = false;
      }
      const definition = {
        id: randomUUID(),
        scope: "project",
        project_id: project.id,
        title: args.p_title,
        active: true,
        pdf_storage_path: project.waiver_pdf_storage_path,
        created_by: args.p_actor_id,
        signers: args.p_signers,
        fields: args.p_fields,
      };
      this.definitions.push(definition);
      project.waiver_definition_id = definition.id;
      return { data: definition.id, error: null };
    }

    if (name === "publish_waiver_staged_project") {
      const outcome = this.publicationOutcome(project, args.p_actor_id);
      if (outcome === "published" && project) {
        project.workflow_status = "published";
      }
      return { data: [{ outcome, workflow_status: null }], error: null };
    }

    throw new Error(`Unexpected rpc: ${name}`);
  }

  private publicationOutcome(project: Row | undefined, actorId: unknown) {
    if (!project) return "project_not_found";
    if (project.creator_id !== actorId) return "forbidden";
    if (project.waiver_required !== true) return "not_waiver_project";

    const path = project.waiver_pdf_storage_path;
    if (typeof path !== "string") return "missing_waiver_source";
    if (!this.objects.has(path)) return "missing_storage_object";

    const esignature = project.waiver_disable_esignature !== true;
    if (!esignature && project.waiver_allow_upload !== true) {
      return "no_signing_mode";
    }
    if (esignature && !project.waiver_definition_id) {
      return "missing_waiver_definition";
    }
    if (project.waiver_definition_id) {
      const definition = this.definitions.find(
        (row) =>
          row.id === project.waiver_definition_id &&
          row.project_id === project.id,
      );
      if (!definition?.active || definition.pdf_storage_path !== path) {
        return "definition_source_mismatch";
      }
      const fields = definition.fields as Array<{ field_type?: string }>;
      if (
        esignature &&
        !fields.some((field) => field.field_type === "signature")
      ) {
        return "definition_missing_signature_field";
      }
    }

    return project.workflow_status === "published"
      ? "already_published"
      : "published";
  }
}

function parentProject(overrides: Record<string, unknown> = {}): Row {
  return {
    id: PARENT_ID,
    creator_id: CREATOR_ID,
    title: "Synthetic riverbank cleanup",
    description: "Synthetic recurring parent",
    location: "Local",
    location_data: null,
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date: "2026-08-20",
        startTime: "09:00",
        endTime: "10:00",
        volunteers: 5,
      },
    },
    verification_method: "manual",
    require_login: true,
    enable_volunteer_comments: false,
    show_attendees_publicly: false,
    organization_id: null,
    visibility: "unlisted",
    project_timezone: "UTC",
    restrict_to_org_domains: false,
    // Exactly one occurrence falls in the window: 2026-08-21.
    recurrence_rule: {
      frequency: "daily",
      interval: 1,
      end_type: "after_occurrences",
      end_occurrences: 2,
    },
    recurrence_parent_id: null,
    recurrence_sequence: null,
    workflow_status: "published",
    status: "upcoming",
    waiver_required: true,
    waiver_allow_upload: true,
    waiver_disable_esignature: false,
    waiver_pdf_storage_path: PARENT_PDF,
    waiver_pdf_url: `https://storage.test/public/${BUCKET}/${PARENT_PDF}`,
    waiver_definition_id: PARENT_DEFINITION_ID,
    ...overrides,
  };
}

function parentDefinition(overrides: Record<string, unknown> = {}): Row {
  return {
    id: PARENT_DEFINITION_ID,
    scope: "project",
    project_id: PARENT_ID,
    title: "Riverbank waiver",
    active: true,
    pdf_storage_path: PARENT_PDF,
    created_by: CREATOR_ID,
    signers: SIGNERS,
    fields: FIELDS,
    ...overrides,
  };
}

function waiverSeries(parentOverrides: Record<string, unknown> = {}) {
  const database = new InMemoryDatabase([parentProject(parentOverrides)]);
  database.definitions.push(parentDefinition());
  database.objects.add(PARENT_PDF);
  return database;
}

const NOW = new Date("2026-08-11T12:00:00Z");
const run = (database: InMemoryDatabase, now = NOW) =>
  processRecurringProjects({ client: database as never, now });

const occurrences = (database: InMemoryDatabase) =>
  database.projects.filter((row) => row.recurrence_parent_id === PARENT_ID);
const published = (database: InMemoryDatabase) =>
  occurrences(database).filter((row) => row.workflow_status === "published");

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe("an occurrence of a waiver-required series", () => {
  test("is published with its own PDF copy and its own definition", async () => {
    const database = waiverSeries();

    const result = await run(database);

    expect(result).toMatchObject({
      checkedProjects: 1,
      processedProjects: 1,
      successfulProjects: 1,
      failedParents: 0,
      createdOccurrences: 1,
      resumedWaiverOccurrences: 0,
      waiverFailures: [],
      errors: [],
    });

    const [occurrence] = occurrences(database);
    expect(occurrences(database)).toHaveLength(1);
    expect(occurrence).toMatchObject({
      creator_id: CREATOR_ID,
      workflow_status: "published",
      status: "upcoming",
      waiver_required: true,
      waiver_allow_upload: true,
      waiver_disable_esignature: false,
      recurrence_sequence: 1,
      recurrence_occurrence_date: "2026-08-21",
    });

    // Its own object, under its own prefix, in the parent's bucket.
    const ownPath = String(occurrence.waiver_pdf_storage_path);
    expect(ownPath.startsWith(`project_waivers/${occurrence.id}/`)).toBe(true);
    expect(database.objects.has(ownPath)).toBe(true);
    expect(database.copies).toEqual([
      { bucket: BUCKET, from: PARENT_PDF, to: ownPath },
    ]);
    expect(occurrence.waiver_pdf_url).toBe(
      `https://storage.test/public/${BUCKET}/${ownPath}`,
    );

    // Its own definition, with the parent's signers and fields.
    const definition = database.definitions.find(
      (row) => row.id === occurrence.waiver_definition_id,
    );
    expect(occurrence.waiver_definition_id).not.toBe(PARENT_DEFINITION_ID);
    expect(definition).toMatchObject({
      project_id: occurrence.id,
      title: "Riverbank waiver",
      pdf_storage_path: ownPath,
      created_by: CREATOR_ID,
      signers: SIGNERS,
      fields: FIELDS,
    });

    // The parent keeps its own waiver untouched.
    expect(database.projects[0]).toMatchObject({
      waiver_pdf_storage_path: PARENT_PDF,
      waiver_definition_id: PARENT_DEFINITION_ID,
    });
    expect(database.objects.has(PARENT_PDF)).toBe(true);
  });

  test("is inserted as a draft and only the database publishes it", async () => {
    const database = waiverSeries();

    await run(database);

    // The row the worker wrote was a draft with no waiver document on it.
    expect(database.insertPayloads).toHaveLength(1);
    expect(database.insertPayloads[0]).toMatchObject({
      recurrence_parent_id: PARENT_ID,
      workflow_status: "draft",
      waiver_required: true,
    });
    expect("waiver_pdf_storage_path" in database.insertPayloads[0]).toBe(false);
    expect("waiver_definition_id" in database.insertPayloads[0]).toBe(false);
    const [occurrence] = occurrences(database);
    expect(database.rpcCalls.map((call) => call.name)).toEqual([
      "save_project_waiver_definition_version",
      "publish_waiver_staged_project",
    ]);
    // Every privileged call names this occurrence and the series creator.
    for (const call of database.rpcCalls) {
      expect(call.args.p_project_id).toBe(occurrence.id);
      expect(call.args.p_actor_id).toBe(CREATOR_ID);
    }
  });

  test("a print-and-upload waiver needs a copy but no definition", async () => {
    const database = waiverSeries({
      waiver_disable_esignature: true,
      waiver_definition_id: null,
    });

    const result = await run(database);

    expect(result.errors).toEqual([]);
    const [occurrence] = published(database);
    expect(occurrence.waiver_definition_id ?? null).toBeNull();
    expect(
      database.objects.has(String(occurrence.waiver_pdf_storage_path)),
    ).toBe(true);
    expect(database.rpcCalls.map((call) => call.name)).toEqual([
      "publish_waiver_staged_project",
    ]);
  });
});

describe("a failure never leaves a published occurrence without its waiver", () => {
  test("a copy failure leaves an invisible draft and is reported", async () => {
    const database = waiverSeries();
    database.failures.copy = true;

    const result = await run(database);

    expect(published(database)).toHaveLength(0);
    expect(occurrences(database)).toHaveLength(1);
    expect(occurrences(database)[0]).toMatchObject({
      workflow_status: "draft",
      waiver_required: true,
    });
    expect(occurrences(database)[0].waiver_pdf_storage_path).toBeUndefined();
    expect(result).toMatchObject({
      successfulProjects: 0,
      failedParents: 1,
      createdOccurrences: 0,
      waiverFailures: [
        {
          parentId: PARENT_ID,
          occurrenceDate: "2026-08-21",
          code: "waiver_copy_failed",
        },
      ],
    });
    // The report names ids and codes, never the project's content.
    expect(result.errors).toEqual([
      `Waiver occurrence left unpublished for parent ${PARENT_ID} on 2026-08-21: waiver_copy_failed`,
    ]);
    expect(
      classifyWorkerResponse("generate-recurring-projects", 200, {
        ...result,
        failedProjects: result.errors.length,
      }),
    ).toMatchObject({ outcome: "failed", completed: 0, failed: 1 });
  });

  test("a publish blocker leaves a draft and is reported with the database's reason", async () => {
    const database = waiverSeries();
    database.failures.copyStoresNothing = true;

    const result = await run(database);

    expect(published(database)).toHaveLength(0);
    expect(occurrences(database)[0]).toMatchObject({
      workflow_status: "draft",
    });
    expect(result.waiverFailures).toEqual([
      {
        parentId: PARENT_ID,
        occurrenceDate: "2026-08-21",
        code: "waiver_publish_blocked",
        blocker: "missing_storage_object",
      },
    ]);
    expect(result.failedParents).toBe(1);
  });

  test("a definition that cannot be saved leaves a draft", async () => {
    const database = waiverSeries();
    database.failures.definition = true;

    const result = await run(database);

    expect(published(database)).toHaveLength(0);
    expect(result.waiverFailures.map((failure) => failure.code)).toEqual([
      "waiver_definition_save_failed",
    ]);
    // Publication was never attempted without the definition.
    expect(database.rpcCalls.map((call) => call.name)).toEqual([
      "save_project_waiver_definition_version",
    ]);
  });

  test("a copy whose row update fails is queued for removal, not left attached", async () => {
    const database = waiverSeries();
    database.failures.attach = true;

    const result = await run(database);

    expect(result.waiverFailures.map((failure) => failure.code)).toEqual([
      "waiver_attach_failed",
    ]);
    expect(database.deletionQueue).toEqual([database.copies[0].to]);
    expect(published(database)).toHaveLength(0);
  });

  test("one failure stops the series for this run instead of staging a draft per date", async () => {
    const database = waiverSeries({
      recurrence_rule: { frequency: "daily", interval: 1, end_type: "never" },
    });
    database.failures.copy = true;

    const result = await run(database);

    expect(occurrences(database)).toHaveLength(1);
    expect(result.waiverFailures).toHaveLength(1);
  });
});

describe("a later run finishes what an earlier run could not", () => {
  test("it resumes the draft instead of creating a second occurrence", async () => {
    const database = waiverSeries();
    database.failures.copy = true;
    await run(database);
    const draftId = occurrences(database)[0].id;

    database.failures.copy = false;
    const result = await run(database);

    expect(result).toMatchObject({
      failedParents: 0,
      createdOccurrences: 0,
      resumedWaiverOccurrences: 1,
      waiverFailures: [],
      errors: [],
    });
    expect(occurrences(database)).toHaveLength(1);
    expect(database.inserted).toHaveLength(1);
    expect(published(database).map((row) => row.id)).toEqual([draftId]);

    // A third run has nothing left to do.
    const third = await run(database);
    expect(third).toMatchObject({
      createdOccurrences: 0,
      resumedWaiverOccurrences: 0,
      errors: [],
    });
    // One failed attempt and one successful copy, and none since.
    expect(database.copies).toHaveLength(2);
  });

  test("a draft that stopped before its definition is rebuilt and the old copy is queued", async () => {
    const database = waiverSeries();
    database.failures.definition = true;
    await run(database);
    const firstCopy = String(occurrences(database)[0].waiver_pdf_storage_path);

    database.failures.definition = false;
    const result = await run(database);

    const [occurrence] = published(database);
    expect(result.resumedWaiverOccurrences).toBe(1);
    expect(occurrences(database)).toHaveLength(1);
    expect(occurrence.waiver_pdf_storage_path).not.toBe(firstCopy);
    expect(database.deletionQueue).toEqual([firstCopy]);
    expect(
      database.definitions.find(
        (row) => row.id === occurrence.waiver_definition_id,
      )?.pdf_storage_path,
    ).toBe(occurrence.waiver_pdf_storage_path);
  });

  test("a finished draft is only published, never copied again", async () => {
    const database = waiverSeries();
    database.failures.copyStoresNothing = true;
    await run(database);
    const [draft] = occurrences(database);
    // The object arrives late; nothing else about the draft changes.
    database.objects.add(String(draft.waiver_pdf_storage_path));
    database.failures.copyStoresNothing = false;

    const result = await run(database);

    expect(result.resumedWaiverOccurrences).toBe(1);
    expect(database.copies).toHaveLength(1);
    expect(database.definitions).toHaveLength(2);
    expect(published(database)).toHaveLength(1);
  });

  test("a draft whose date has passed, or that was cancelled, is left alone", async () => {
    const database = waiverSeries();
    database.failures.copy = true;
    await run(database);
    database.failures.copy = false;

    const afterItsDate = await run(database, new Date("2026-08-22T12:00:00Z"));
    expect(afterItsDate.resumedWaiverOccurrences).toBe(0);
    expect(published(database)).toHaveLength(0);

    occurrences(database)[0].status = "cancelled";
    const whileCancelled = await run(database);
    expect(whileCancelled.resumedWaiverOccurrences).toBe(0);
    expect(published(database)).toHaveLength(0);
  });
});

describe("the resume cap only counts drafts that can be resumed", () => {
  /** A staged draft of the series, as a failed run leaves it. */
  function draft(date: string, overrides: Record<string, unknown> = {}): Row {
    return {
      ...parentProject(),
      id: randomUUID(),
      recurrence_rule: null,
      recurrence_parent_id: PARENT_ID,
      recurrence_sequence: null,
      recurrence_occurrence_date: date,
      workflow_status: "draft",
      waiver_pdf_storage_path: null,
      waiver_pdf_url: null,
      waiver_definition_id: null,
      ...overrides,
    };
  }
  const day = (offset: number) =>
    new Date(Date.UTC(2026, 5, 1 + offset)).toISOString().slice(0, 10);

  test("more than 50 ineligible drafts do not hide a later eligible one", async () => {
    const database = waiverSeries();
    // 60 past drafts (June and July), then 30 cancelled and 30 waiver-free
    // future drafts, every one dated before the single eligible draft.
    for (let index = 0; index < 60; index++) {
      database.projects.push(draft(day(index)));
    }
    for (let index = 0; index < 30; index++) {
      database.projects.push(
        draft(day(72 + index), { status: "cancelled" }),
        draft(day(102 + index), { waiver_required: false }),
      );
    }
    const eligible = draft("2026-12-01");
    database.projects.push(eligible);

    const result = await run(database);

    expect(result).toMatchObject({
      resumedWaiverOccurrences: 1,
      createdOccurrences: 0,
      waiverFailures: [],
      errors: [],
    });
    expect(published(database).map((row) => row.id)).toEqual([eligible.id]);
    expect(
      occurrences(database).filter((row) => row.workflow_status === "draft"),
    ).toHaveLength(120);
  });

  test("eligible drafts are resumed earliest occurrence first", async () => {
    const database = waiverSeries();
    database.projects.push(
      draft("2026-08-25"),
      draft("2026-08-22"),
      draft("2026-08-23"),
    );

    await run(database);

    const publishedDates = database.rpcCalls
      .filter((call) => call.name === "publish_waiver_staged_project")
      .map(
        (call) =>
          database.projects.find((row) => row.id === call.args.p_project_id)
            ?.recurrence_occurrence_date,
      );
    expect(publishedDates).toEqual(["2026-08-22", "2026-08-23", "2026-08-25"]);
  });
});

describe("today is the date in the project's own time zone", () => {
  // 01:10 UTC on the 12th is 18:10 on the 11th in Los Angeles.
  const EARLY_UTC = new Date("2026-08-12T01:10:00Z");
  const losAngelesSeries = () =>
    waiverSeries({
      project_timezone: "America/Los_Angeles",
      schedule: {
        oneTime: {
          date: "2026-08-10",
          startTime: "09:00",
          endTime: "10:00",
          volunteers: 5,
        },
      },
      // Occurrences on the 11th and the 12th.
      recurrence_rule: {
        frequency: "daily",
        interval: 1,
        end_type: "after_occurrences",
        end_occurrences: 3,
      },
    });

  test("the 01:10 UTC run resumes a draft dated tomorrow in Los Angeles", async () => {
    const database = losAngelesSeries();
    database.failures.copy = true;
    // The afternoon before, Los Angeles time: the 12th is staged and fails.
    const first = await run(database, new Date("2026-08-11T22:00:00Z"));
    expect(first.waiverFailures).toHaveLength(1);
    expect(occurrences(database)).toMatchObject([
      { recurrence_occurrence_date: "2026-08-12", workflow_status: "draft" },
    ]);

    database.failures.copy = false;
    const result = await run(database, EARLY_UTC);

    expect(result).toMatchObject({
      resumedWaiverOccurrences: 1,
      createdOccurrences: 0,
      waiverFailures: [],
      errors: [],
    });
    expect(published(database)).toMatchObject([
      { recurrence_occurrence_date: "2026-08-12" },
    ]);
  });

  test("the 01:10 UTC run still creates the occurrence dated tomorrow in Los Angeles", async () => {
    const database = losAngelesSeries();

    const result = await run(database, EARLY_UTC);

    expect(result).toMatchObject({ createdOccurrences: 1, errors: [] });
    expect(published(database)).toMatchObject([
      { recurrence_occurrence_date: "2026-08-12" },
    ]);
  });

  test("a draft dated today in Los Angeles is not resumed", async () => {
    const database = losAngelesSeries();
    database.failures.copy = true;
    await run(database, new Date("2026-08-11T22:00:00Z"));
    database.failures.copy = false;

    // 07:10 UTC on the 12th is 00:10 on the 12th in Los Angeles.
    const result = await run(database, new Date("2026-08-12T07:10:00Z"));

    expect(result.resumedWaiverOccurrences).toBe(0);
    expect(published(database)).toHaveLength(0);
  });

  test("a zone ahead of UTC does not publish for a date that has already begun there", async () => {
    const database = waiverSeries({
      project_timezone: "Pacific/Auckland",
      schedule: {
        oneTime: {
          date: "2026-08-10",
          startTime: "09:00",
          endTime: "10:00",
          volunteers: 5,
        },
      },
      recurrence_rule: {
        frequency: "daily",
        interval: 1,
        end_type: "after_occurrences",
        end_occurrences: 3,
      },
    });

    // 13:00 UTC on the 11th is 01:00 on the 12th in Auckland.
    const result = await run(database, new Date("2026-08-11T13:00:00Z"));

    expect(result.createdOccurrences).toBe(0);
    expect(occurrences(database)).toHaveLength(0);
  });
});

describe("the waiver an occurrence gets", () => {
  test("is the parent's waiver at generation time; earlier occurrences keep theirs", async () => {
    const database = waiverSeries({
      recurrence_rule: { frequency: "monthly", interval: 1, end_type: "never" },
    });

    await run(database, new Date("2026-08-25T12:00:00Z"));
    const [first] = published(database);
    const firstPath = first.waiver_pdf_storage_path;
    const firstDefinition = first.waiver_definition_id;

    // The organizer replaces the PDF and its placements on the parent.
    const replacedPdf = `project_waivers/${PARENT_ID}/1800000000000_waiver.pdf`;
    const replacedFields = [{ ...FIELDS[0], page_index: 2 }];
    database.objects.add(replacedPdf);
    database.definitions[0].active = false;
    database.definitions.push(
      parentDefinition({
        id: "55555555-5555-4555-8555-555555555555",
        title: "Riverbank waiver, revised",
        pdf_storage_path: replacedPdf,
        fields: replacedFields,
      }),
    );
    Object.assign(database.projects[0], {
      waiver_pdf_storage_path: replacedPdf,
      waiver_definition_id: "55555555-5555-4555-8555-555555555555",
    });

    const result = await run(database, new Date("2026-09-25T12:00:00Z"));

    expect(result.errors).toEqual([]);
    const second = published(database).find((row) => row.id !== first.id);
    expect(database.copies.at(-1)?.from).toBe(replacedPdf);
    expect(
      database.definitions.find(
        (row) => row.id === second?.waiver_definition_id,
      ),
    ).toMatchObject({
      title: "Riverbank waiver, revised",
      fields: replacedFields,
    });
    expect(first.waiver_pdf_storage_path).toBe(firstPath);
    expect(first.waiver_definition_id).toBe(firstDefinition);
  });
});

describe("the worker only reads the parent's own waiver", () => {
  const refusedParents: Array<{
    name: string;
    overrides: Record<string, unknown>;
    code: OccurrenceWaiverFailureCode;
  }> = [
    {
      name: "a stored path under another project's prefix",
      overrides: {
        waiver_pdf_storage_path: `project_waivers/${OTHER_PROJECT_ID}/1700000000000_waiver.pdf`,
      },
      code: "parent_waiver_source_missing",
    },
    {
      name: "no stored path",
      overrides: { waiver_pdf_storage_path: null },
      code: "parent_waiver_source_missing",
    },
    {
      name: "a definition id that is not one of the parent's definitions",
      overrides: { waiver_definition_id: randomUUID() },
      code: "parent_waiver_definition_unavailable",
    },
    {
      name: "e-signatures with no definition",
      overrides: { waiver_definition_id: null },
      code: "parent_waiver_definition_unavailable",
    },
    {
      name: "no creator to act as",
      overrides: { creator_id: null },
      code: "parent_creator_missing",
    },
  ];

  for (const { name, overrides, code } of refusedParents) {
    test(`${name} stages nothing and is reported`, async () => {
      const database = waiverSeries(overrides);
      database.objects.add(
        `project_waivers/${OTHER_PROJECT_ID}/1700000000000_waiver.pdf`,
      );

      const result = await run(database);

      expect(occurrences(database)).toHaveLength(0);
      expect(database.copies).toEqual([]);
      expect(database.rpcCalls).toEqual([]);
      expect(result.waiverFailures).toEqual([
        { parentId: PARENT_ID, occurrenceDate: null, code },
      ]);
      expect(result).toMatchObject({ failedParents: 1, createdOccurrences: 0 });
    });
  }
});

describe("a series without a waiver", () => {
  test("is published directly, with no storage or waiver calls", async () => {
    const database = new InMemoryDatabase([
      parentProject({
        waiver_required: false,
        waiver_pdf_storage_path: null,
        waiver_pdf_url: null,
        waiver_definition_id: null,
      }),
    ]);

    const result = await run(database);

    expect(result).toMatchObject({
      successfulProjects: 1,
      failedParents: 0,
      createdOccurrences: 1,
      resumedWaiverOccurrences: 0,
      waiverFailures: [],
      errors: [],
    });
    expect(database.copies).toEqual([]);
    expect(database.rpcCalls).toEqual([]);
    expect(database.inserted[0]).toMatchObject({
      workflow_status: "published",
      recurrence_occurrence_date: "2026-08-21",
    });
    for (const column of [
      "waiver_required",
      "waiver_pdf_storage_path",
      "waiver_pdf_url",
      "waiver_definition_id",
    ]) {
      expect(column in database.inserted[0]).toBe(false);
    }
  });

  test("still settles when a waiver series beside it fails", async () => {
    const healthy = parentProject({
      id: "66666666-6666-4666-8666-666666666666",
      waiver_required: false,
      waiver_pdf_storage_path: null,
      waiver_definition_id: null,
    });
    const database = waiverSeries();
    database.projects.push(healthy);
    database.failures.copy = true;

    const result = await run(database);

    expect(result).toMatchObject({
      checkedProjects: 2,
      successfulProjects: 1,
      failedParents: 1,
      createdOccurrences: 1,
    });
    expect(
      database.projects.filter(
        (row) =>
          row.recurrence_parent_id === healthy.id &&
          row.workflow_status === "published",
      ),
    ).toHaveLength(1);
  });
});
