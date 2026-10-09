import { describe, expect, spyOn, test } from "bun:test";

import { processRecurringProjects } from "@/services/recurring-project-worker";
import { classifyWorkerResponse } from "@/lib/cron/worker-outcome";

type StoredProject = Record<string, unknown> & {
  id: string;
  recurrence_parent_id: string | null;
  recurrence_rule: Record<string, unknown> | null;
  recurrence_sequence: number | null;
  recurrence_occurrence_date?: string | null;
  schedule: Record<string, unknown>;
};

type QueryError = { code?: string; message: string; details?: string };
type QueryResult = { data: unknown; error: QueryError | null };

class ProjectsQuery {
  private readonly equals = new Map<string, unknown>();
  private readonly isNull = new Set<string>();
  private readonly notFilters: Array<{
    column: string;
    operator: string;
    value: unknown;
  }> = [];
  private readonly jsonFilters: Array<{
    path: string;
    value: string;
  }> = [];
  private readonly orders: Array<{ column: string; ascending: boolean }> = [];
  private greaterThanId: string | null = null;
  private rowLimit: number | null = null;

  constructor(private readonly database: InMemoryRecurringDatabase) {}

  select() {
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
    this.notFilters.push({ column, operator, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
    });
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  gt(column: string, value: string) {
    if (column === "id") this.greaterThanId = value;
    return this;
  }

  filter(path: string, _operator: string, value: string) {
    this.jsonFilters.push({ path, value });
    return this;
  }

  insert(payload: Record<string, unknown>): Promise<QueryResult> {
    const failure = this.database.insertErrors.get(
      String(payload.recurrence_parent_id),
    );
    if (failure) return Promise.resolve({ data: null, error: failure });
    const row = {
      id: `occurrence-${String(this.database.inserted.length).padStart(5, "0")}`,
      recurrence_rule: null,
      ...payload,
    } as StoredProject;
    this.database.projects.push(row);
    this.database.inserted.push(row);
    return Promise.resolve({ data: null, error: null });
  }

  private matchingRows(): StoredProject[] {
    let rows = this.database.projects.filter((row) => {
      for (const [column, value] of this.equals) {
        if (row[column] !== value) return false;
      }
      for (const column of this.isNull) {
        if (row[column] !== null && row[column] !== undefined) return false;
      }
      for (const filter of this.notFilters) {
        if (filter.operator === "is" && filter.value === null) {
          if (row[filter.column] === null || row[filter.column] === undefined) {
            return false;
          }
        } else if (
          filter.operator === "eq" &&
          row[filter.column] === filter.value
        ) {
          return false;
        }
      }
      if (this.greaterThanId && row.id <= this.greaterThanId) return false;

      for (const filter of this.jsonFilters) {
        const expectedEventType = filter.path.includes("oneTime")
          ? "oneTime"
          : "sameDayMultiArea";
        const eventSchedule = row.schedule[expectedEventType] as
          { date?: string } | undefined;
        if (eventSchedule?.date !== filter.value) return false;
      }
      return true;
    });

    for (const order of [...this.orders].reverse()) {
      rows = rows.toSorted((left, right) => {
        const leftValue = left[order.column];
        const rightValue = right[order.column];
        const comparison = String(leftValue ?? "").localeCompare(
          String(rightValue ?? ""),
        );
        return order.ascending ? comparison : -comparison;
      });
    }

    return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
  }

  private execute(single: boolean, allowEmpty: boolean): QueryResult {
    const rows = this.matchingRows();
    if (!single) return { data: rows, error: null };
    if (rows.length === 0) {
      return allowEmpty
        ? { data: null, error: null }
        : {
            data: null,
            error: {
              code: "PGRST116",
              message: "JSON object requested, no rows",
            },
          };
    }
    if (rows.length > 1) {
      return {
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple rows returned",
        },
      };
    }
    return { data: rows[0], error: null };
  }

  maybeSingle() {
    const failure = this.database.latestErrors.get(
      String(this.equals.get("recurrence_parent_id")),
    );
    if (failure) return Promise.resolve({ data: null, error: failure });
    return Promise.resolve(this.execute(true, true));
  }

  single() {
    return Promise.resolve(this.execute(true, false));
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false, true)).then(
      onfulfilled,
      onrejected,
    );
  }
}

class InMemoryRecurringDatabase {
  readonly inserted: StoredProject[] = [];
  readonly latestErrors = new Map<string, QueryError>();
  readonly insertErrors = new Map<string, QueryError>();

  constructor(readonly projects: StoredProject[]) {}

  from(table: string) {
    if (table !== "projects") throw new Error(`Unexpected table: ${table}`);
    return new ProjectsQuery(this);
  }
}

function parentProject(
  id: string,
  recurrenceRule: Record<string, unknown>,
  date = "2026-08-20",
): StoredProject {
  return {
    id,
    creator_id: "creator-1",
    title: `Parent ${id}`,
    description: "Synthetic recurring parent",
    location: "Local",
    location_data: null,
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date,
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
    recurrence_rule: recurrenceRule,
    recurrence_parent_id: null,
    recurrence_sequence: null,
    workflow_status: "published",
    status: "upcoming",
  };
}

const TWO_OCCURRENCES = {
  frequency: "daily",
  interval: 1,
  end_type: "after_occurrences",
  end_occurrences: 2,
};

describe("recurring project worker pagination and catch-up", () => {
  test("a failed latest-occurrence lookup cannot count as a completed parent", async () => {
    const database = new InMemoryRecurringDatabase([
      parentProject("failed-parent", TWO_OCCURRENCES),
    ]);
    database.latestErrors.set("failed-parent", {
      code: "42501",
      message: "synthetic lookup denied",
    });
    const result = await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-11T12:00:00Z"),
    });
    expect(result).toMatchObject({
      processedProjects: 1,
      checkedProjects: 1,
      successfulProjects: 0,
      failedParents: 1,
      createdOccurrences: 0,
    });
    expect(result.errors).toHaveLength(1);
    expect(database.inserted).toHaveLength(0);
    expect(
      classifyWorkerResponse("generate-recurring-projects", 200, {
        ...result,
        failedProjects: result.errors.length,
      }),
    ).toMatchObject({ outcome: "failed", completed: 0, failed: 1 });
  });
  test("multiple occurrence errors count one failed parent while healthy parents still settle", async () => {
    const rule = { ...TWO_OCCURRENCES, end_occurrences: 4 };
    const database = new InMemoryRecurringDatabase([
      parentProject("failed-parent", rule),
      parentProject("healthy-parent", TWO_OCCURRENCES),
    ]);
    database.insertErrors.set("failed-parent", {
      code: "42501",
      message: "synthetic insert denied",
    });
    const result = await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-11T12:00:00Z"),
    });
    expect(result).toMatchObject({
      processedProjects: 2,
      checkedProjects: 2,
      successfulProjects: 1,
      failedParents: 1,
      createdOccurrences: 1,
    });
    expect(result.errors.length).toBeGreaterThan(1);
    expect(
      classifyWorkerResponse("generate-recurring-projects", 200, {
        ...result,
        failedProjects: result.errors.length,
      }),
    ).toMatchObject({ outcome: "partial", completed: 1, failed: 1 });
  });
  test("processes stable pages beyond the former 20-parent prefix", async () => {
    const database = new InMemoryRecurringDatabase(
      Array.from({ length: 25 }, (_, index) =>
        parentProject(
          `parent-${String(index).padStart(3, "0")}`,
          TWO_OCCURRENCES,
        ),
      ),
    );

    const result = await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-11T12:00:00Z"),
      parentPageSize: 20,
    });

    expect(result.processedProjects).toBe(25);
    expect(result).toMatchObject({
      checkedProjects: 25,
      successfulProjects: 25,
      failedParents: 0,
    });
    expect(result.createdOccurrences).toBe(25);
    expect(
      new Set(database.inserted.map((row) => row.recurrence_parent_id)).size,
    ).toBe(25);
  });

  test("walks past more than 200 corrupt rows to reach a healthy parent", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const corrupt = Array.from({ length: 205 }, (_, index) =>
      parentProject(`corrupt-${String(index).padStart(3, "0")}`, {
        frequency: "daily",
        interval: 0,
        end_type: "never",
      }),
    );
    const database = new InMemoryRecurringDatabase([
      ...corrupt,
      parentProject("healthy-999", TWO_OCCURRENCES),
    ]);

    try {
      const result = await processRecurringProjects({
        client: database as never,
        now: new Date("2026-08-11T12:00:00Z"),
        parentPageSize: 20,
      });

      expect(result.processedProjects).toBe(1);
      expect(result).toMatchObject({
        checkedProjects: 206,
        successfulProjects: 1,
        failedParents: 205,
      });
      expect(result.createdOccurrences).toBe(1);
      expect(database.inserted[0]?.recurrence_parent_id).toBe("healthy-999");
      expect(result.errors).toHaveLength(205);
    } finally {
      warn.mockRestore();
    }
  });

  test("fast-forwards a never-ending series far behind before applying the write cap", async () => {
    const database = new InMemoryRecurringDatabase([
      parentProject(
        "ancient-parent",
        {
          frequency: "daily",
          interval: 1,
          end_type: "never",
        },
        "2020-01-01",
      ),
    ]);

    const result = await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-11T12:00:00Z"),
      parentPageSize: 20,
    });

    expect(result.processedProjects).toBe(1);
    expect(result.createdOccurrences).toBeGreaterThan(0);
    expect(result.errors.join("\n")).not.toContain("Iteration cap");
    expect(
      database.inserted.every(
        (row) => String(row.recurrence_occurrence_date) > "2026-08-11",
      ),
    ).toBe(true);
  });
});

function occurrenceRows(database: InMemoryRecurringDatabase) {
  return database.inserted.map((row) => ({
    sequence: row.recurrence_sequence,
    occurrenceDate: row.recurrence_occurrence_date,
    scheduleDate: (row.schedule.oneTime as { date?: string }).date,
  }));
}

describe("recurring occurrences keep the series' settings", () => {
  test("copies sign-up questions, cover image, documents and management settings", async () => {
    const signupFormSchema = {
      version: 1,
      sections: [
        { fields: [{ key: "shirt_size", label: "Shirt size", type: "text" }] },
      ],
    };
    const documents = [{ name: "synthetic-guide.pdf", url: "local://guide" }];
    const database = new InMemoryRecurringDatabase([
      {
        ...parentProject("settings-parent", TWO_OCCURRENCES),
        signup_form_schema: signupFormSchema,
        cover_image_url: "local://cover.png",
        documents,
        can_be_managed_by_staff: false,
        pause_signups: true,
        waiver_required: false,
        waiver_allow_upload: false,
        waiver_disable_esignature: true,
      },
    ]);

    const result = await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-11T12:00:00Z"),
    });

    expect(result.errors).toEqual([]);
    expect(database.inserted).toHaveLength(1);
    expect(database.inserted[0]).toMatchObject({
      recurrence_parent_id: "settings-parent",
      signup_form_schema: signupFormSchema,
      cover_image_url: "local://cover.png",
      documents,
      can_be_managed_by_staff: false,
      pause_signups: true,
      waiver_allow_upload: false,
      waiver_disable_esignature: true,
      workflow_status: "published",
      status: "upcoming",
    });
    // A series without a waiver adds no waiver document to its occurrences.
    // Waiver-required series are covered in
    // services/recurring-project-worker.waiver.test.ts.
    for (const column of [
      "waiver_required",
      "waiver_pdf_storage_path",
      "waiver_pdf_url",
      "waiver_definition_id",
    ]) {
      expect(column in database.inserted[0]).toBe(false);
    }
  });
});

describe("recurring occurrence dates do not drift", () => {
  test("a monthly series from the 31st uses each month's own last day across runs", async () => {
    const database = new InMemoryRecurringDatabase([
      parentProject(
        "month-end-parent",
        { frequency: "monthly", interval: 1, end_type: "never" },
        "2027-01-31",
      ),
    ]);

    for (const now of [
      "2027-02-10T12:00:00Z",
      "2027-03-05T12:00:00Z",
      "2027-04-05T12:00:00Z",
    ]) {
      const result = await processRecurringProjects({
        client: database as never,
        now: new Date(now),
      });
      expect(result.errors).toEqual([]);
    }

    expect(occurrenceRows(database)).toEqual([
      { sequence: 1, occurrenceDate: "2027-02-28", scheduleDate: "2027-02-28" },
      { sequence: 2, occurrenceDate: "2027-03-31", scheduleDate: "2027-03-31" },
      { sequence: 3, occurrenceDate: "2027-04-30", scheduleDate: "2027-04-30" },
    ]);
  });

  test("a yearly series from February 29 returns to the 29th in the next leap year", async () => {
    const database = new InMemoryRecurringDatabase([
      parentProject(
        "leap-day-parent",
        { frequency: "yearly", interval: 1, end_type: "never" },
        "2028-02-29",
      ),
    ]);

    for (const year of [2029, 2030, 2031, 2032]) {
      await processRecurringProjects({
        client: database as never,
        now: new Date(`${year}-02-10T12:00:00Z`),
      });
    }

    expect(
      database.inserted.map((row) => row.recurrence_occurrence_date),
    ).toEqual(["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });

  test("an edited child does not shift the series", async () => {
    // 2026-08-03 is a Monday.
    const database = new InMemoryRecurringDatabase([
      parentProject(
        "weekly-parent",
        { frequency: "weekly", interval: 1, end_type: "never" },
        "2026-08-03",
      ),
    ]);

    await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-04T12:00:00Z"),
    });
    expect(
      database.inserted.map((row) => row.recurrence_occurrence_date),
    ).toEqual(["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);

    // An organizer moves two occurrences: one onto the date of a later
    // occurrence, and the newest one to a different day of its week.
    const moved = database.inserted[2].schedule.oneTime as { date: string };
    moved.date = "2026-09-07";
    const newest = database.inserted[3].schedule.oneTime as { date: string };
    newest.date = "2026-09-03";

    const result = await processRecurringProjects({
      client: database as never,
      now: new Date("2026-08-11T12:00:00Z"),
    });

    expect(result.errors).toEqual([]);
    expect(result.createdOccurrences).toBe(1);
    expect(occurrenceRows(database).at(-1)).toEqual({
      sequence: 5,
      occurrenceDate: "2026-09-07",
      scheduleDate: "2026-09-07",
    });
  });

  test("a second run in the same window creates nothing new", async () => {
    const database = new InMemoryRecurringDatabase([
      parentProject(
        "idempotent-parent",
        {
          frequency: "weekly",
          interval: 1,
          end_type: "never",
          weekdays: ["monday", "thursday"],
        },
        "2026-08-03",
      ),
    ]);
    const now = new Date("2026-08-04T12:00:00Z");

    const first = await processRecurringProjects({
      client: database as never,
      now,
    });
    const second = await processRecurringProjects({
      client: database as never,
      now,
    });

    expect(first.createdOccurrences).toBe(8);
    expect(second.createdOccurrences).toBe(0);
    expect(
      database.inserted.map((row) => row.recurrence_occurrence_date),
    ).toEqual([
      "2026-08-06",
      "2026-08-10",
      "2026-08-13",
      "2026-08-17",
      "2026-08-20",
      "2026-08-24",
      "2026-08-27",
      "2026-08-31",
    ]);
  });
});
