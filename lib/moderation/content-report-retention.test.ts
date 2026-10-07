import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  detachContentReportReporter,
  formatContentReportReporterLabel,
} from "./content-report-retention";

/**
 * The helper performs one server-owned detachment. Account deletion coverage
 * lives in the durable cleanup service tests and database transaction tests.
 */

type Operation = {
  relation: string;
  verb: "select" | "update" | "delete" | "rpc";
  filters: Array<[string, unknown]>;
  values?: Record<string, unknown>;
};

function recordingClient(options: { updateError?: { message: string } } = {}) {
  const operations: Operation[] = [];

  const builder = (operation: Operation) => {
    const chain = {
      eq(column: string, value: unknown) {
        operation.filters.push([column, value]);
        return chain;
      },
      in(column: string, value: unknown) {
        operation.filters.push([column, value]);
        return chain;
      },
      select() {
        return chain;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then(
        resolve: (result: {
          data: unknown[];
          error: { message: string } | null;
          count: number;
        }) => unknown,
      ) {
        return Promise.resolve(
          resolve({
            data: [],
            error:
              operation.verb === "update" && options.updateError
                ? options.updateError
                : null,
            count: 0,
          }),
        );
      },
    };
    return chain;
  };

  const client = {
    from(relation: string) {
      return {
        select() {
          const operation: Operation = {
            relation,
            verb: "select",
            filters: [],
          };
          operations.push(operation);
          return builder(operation);
        },
        update(values: Record<string, unknown>) {
          const operation: Operation = {
            relation,
            verb: "update",
            filters: [],
            values,
          };
          operations.push(operation);
          return builder(operation);
        },
        delete() {
          const operation: Operation = {
            relation,
            verb: "delete",
            filters: [],
          };
          operations.push(operation);
          return builder(operation);
        },
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      const operation: Operation = {
        relation: name,
        verb: "rpc",
        filters: [],
        values: args,
      };
      operations.push(operation);
      return Promise.resolve({
        data: null,
        error: options.updateError ?? null,
      });
    },
    auth: {
      admin: {
        deleteUser: async () => ({ error: null }),
      },
    },
  };

  return { client: client as unknown as SupabaseClient, operations };
}

const USER_ID = "20000000-0000-4000-8000-000000000001";

describe("content report retention", () => {
  test("formats a stable opaque label for a detached reporter", () => {
    expect(
      formatContentReportReporterLabel("ab12cd34-0000-4000-8000-000000000001"),
    ).toBe("Reporter AB12CD34");
    expect(formatContentReportReporterLabel(null)).toBeNull();
  });

  test("detaching atomically clears the report and pseudonym actor links", async () => {
    const { client, operations } = recordingClient();

    await detachContentReportReporter(client, USER_ID);

    expect(operations).toEqual([
      {
        relation: "detach_content_report_reporter",
        verb: "rpc",
        filters: [],
        values: { p_reporter_id: USER_ID },
      },
    ]);
  });

  test("a failed detach is surfaced rather than ignored", async () => {
    const { client } = recordingClient({
      updateError: { message: "connection reset" },
    });

    expect(detachContentReportReporter(client, USER_ID)).rejects.toThrow(
      /Failed to detach content reports/u,
    );
  });
});
