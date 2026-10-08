import assert from "node:assert/strict";

export type Stored = Record<string, unknown>;
type ScanQueryState = {
  tables: Record<string, Stored[]>;
  writes: Array<{ table: string; operation: string }>;
  reads: Array<{ table: string; start: number; end: number }>;
  omitPrintedCandidate: boolean;
  failReviewSettlement: boolean;
  afterStaging: () => void;
};

export function createScanQueryFixture(state: ScanQueryState) {
  return class Query {
    private operation = "select";
    private start = 0;
    private end = 999;
    private columns = "";
    private values: Stored | Stored[] = {};
    private filters: Array<(row: Stored) => boolean> = [];
    constructor(private table: string) {
      assert.ok(table in state.tables, `Unexpected table: ${table}`);
    }
    select(columns: string) {
      this.columns = columns;
      return this;
    }
    range(start: number, end: number) {
      this.start = start;
      this.end = end;
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((row) => values.includes(row[column]));
      return this;
    }
    or(expression: string) {
      const pairs = [
        ...expression.matchAll(
          /and\(sheet_id\.eq\.([^,]+),row_reference\.eq\.([^)]+)\)/g,
        ),
      ];
      this.filters.push((row) =>
        pairs.some(
          (pair) => row.sheet_id === pair[1] && row.row_reference === pair[2],
        ),
      );
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
      let matching = state.tables[this.table].filter((row) =>
        this.filters.every((filter) => filter(row)),
      );
      if (this.operation === "select") {
        state.reads.push({
          table: this.table,
          start: this.start,
          end: this.end,
        });
        if (
          state.omitPrintedCandidate &&
          this.table === "project_signups" &&
          this.columns.includes("profiles(")
        )
          matching = [];
        matching = matching.slice(
          this.start,
          Math.min(this.end + 1, this.start + 1000),
        );
      }
      if (this.operation !== "select") {
        assert.ok(
          ["project_paper_scan_batches", "project_paper_scan_rows"].includes(
            this.table,
          ),
          "Extraction must never write attendance or credit",
        );
        state.writes.push({ table: this.table, operation: this.operation });
      }
      if (this.operation === "update") {
        if (
          state.failReviewSettlement &&
          (this.values as Stored).status === "review"
        ) {
          state.failReviewSettlement = false;
          return { data: null, error: { code: "fictional_lost_settlement" } };
        }
        for (const row of matching) Object.assign(row, this.values);
      } else if (this.operation === "delete") {
        state.tables[this.table] = state.tables[this.table].filter(
          (row) => !matching.includes(row),
        );
      } else if (this.operation === "insert") {
        state.tables[this.table].push(
          ...structuredClone(this.values as Stored[]),
        );
        state.afterStaging?.();
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
  };
}
