import { describe, expect, spyOn, test } from "bun:test";

import { processRecurringProjects } from "@/services/recurring-project-worker";

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
