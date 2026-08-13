import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { detachContentReportReporter } from "./content-report-retention";
import { deleteUserWithCleanup } from "@/lib/supabase/delete-user-with-cleanup";

/**
 * Moderation evidence must survive the reporter's account. These run the real
 * deletion path against a recorder so a regression that re-adds
 * `content_reports` to the delete list fails here.
 */

type Operation = {
  relation: string;
  verb: "select" | "update" | "delete";
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
  test("detaching clears only the actor link", async () => {
    const { client, operations } = recordingClient();

    await detachContentReportReporter(client, USER_ID);

    expect(operations).toEqual([
      {
        relation: "content_reports",
        verb: "update",
        filters: [["reporter_id", USER_ID]],
        values: { reporter_id: null },
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

  test("account deletion detaches reports instead of deleting them", async () => {
    const { client, operations } = recordingClient();

    const report = await deleteUserWithCleanup(client, USER_ID, {
      deleteProjects: false,
      deleteOrganizations: false,
    });

    const reportOperations = operations.filter(
      (operation) => operation.relation === "content_reports",
    );
    expect(reportOperations).toHaveLength(1);
    expect(reportOperations[0]?.verb).toBe("update");
    expect(reportOperations[0]?.values).toEqual({ reporter_id: null });
    expect(
      operations.some(
        (operation) =>
          operation.relation === "content_reports" &&
          operation.verb === "delete",
      ),
    ).toBe(false);
    expect(report.notes).toContain(
      "content_reports retained with the reporter link detached.",
    );
  });

  test("a failed detach stops account deletion before anything is removed", async () => {
    const { client, operations } = recordingClient({
      updateError: { message: "connection reset" },
    });

    expect(
      deleteUserWithCleanup(client, USER_ID, {
        deleteProjects: false,
        deleteOrganizations: false,
      }),
    ).rejects.toThrow(/Failed to detach content reports/u);

    expect(operations.some((operation) => operation.verb === "delete")).toBe(
      false,
    );
  });

  test("account deletion still removes the reporter's own private records", async () => {
    const { client, operations } = recordingClient();

    await deleteUserWithCleanup(client, USER_ID, {
      deleteProjects: false,
      deleteOrganizations: false,
    });

    const deleted = operations
      .filter((operation) => operation.verb === "delete")
      .map((operation) => operation.relation);
    expect(deleted).toContain("feedback");
    expect(deleted).toContain("notifications");
    expect(deleted).toContain("profiles");
  });
});
