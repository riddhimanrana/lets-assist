import { expect, test } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_CLIENT_SELECT } from "./client-projection";

const privateFields = ["review_notes", "reviewed_by", "reviewed_at"];
const columns = PROJECT_CLIENT_SELECT.split(",").map((value) => value.trim());

test("the project client projection equals every browser column grant", () => {
  const migration = readFileSync(
    resolve(
      import.meta.dir,
      "../../supabase/migrations/20261007230000_project_client_read_columns.sql",
    ),
    "utf8",
  );
  const grants = [
    ...migration.matchAll(
      /GRANT\s+((?:SELECT|INSERT|UPDATE)[\s\S]*?)\s+ON(?:\s+TABLE)?\s+public\.projects\s+TO\s+([^;]+);/giu,
    ),
  ];
  const privileges: string[] = [];
  for (const grant of grants) {
    const roles = grant[2].split(",").map((value) => value.trim());
    for (const permission of grant[1].matchAll(
      /(SELECT|INSERT|UPDATE)\s*\(([^)]+)\)/giu,
    )) {
      const allowed = permission[2].split(",").map((value) => value.trim());
      expect(columns).toEqual(allowed);
      privileges.push(
        ...roles.map((role) => `${role}:${permission[1].toUpperCase()}`),
      );
    }
  }
  expect(privileges.sort()).toEqual([
    "anon:SELECT",
    "authenticated:INSERT",
    "authenticated:SELECT",
    "authenticated:UPDATE",
  ]);
  expect(new Set(columns).size).toBe(columns.length);
  expect(columns).toHaveLength(43);
  expect(columns.filter((column) => privateFields.includes(column))).toEqual(
    [],
  );
  expect(PROJECT_CLIENT_SELECT).not.toContain("*");
});

test("Supabase serializes direct and nested project projections without private fields", async () => {
  const requests: URL[] = [];
  const client = createClient("http://127.0.0.1:54321", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: Object.assign(
        async (input: RequestInfo | URL) => {
          requests.push(
            new URL(
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url,
            ),
          );
          return new Response("[]", {
            headers: { "Content-Type": "application/json" },
          });
        },
        { preconnect: () => {} },
      ),
    },
  });
  const direct = await client
    .from("projects")
    .select(PROJECT_CLIENT_SELECT)
    .eq("creator_id", "fixture-owner");
  const nested = await client
    .from("project_signups")
    .select(
      `id,projects!project_signups_project_id_fkey(${PROJECT_CLIENT_SELECT},organizations(name,logo_url,username))`,
    )
    .eq("user_id", "fixture-volunteer");
  expect(direct.error).toBeNull();
  expect(nested.error).toBeNull();
  expect(requests).toHaveLength(2);
  expect(requests[0].searchParams.get("select")).toBe(columns.join(","));
  expect(requests[0].searchParams.get("creator_id")).toBe("eq.fixture-owner");
  expect(requests[1].searchParams.get("select")).toBe(
    `id,projects!project_signups_project_id_fkey(${columns.join(",")},organizations(name,logo_url,username))`,
  );
  expect(requests[1].searchParams.get("user_id")).toBe("eq.fixture-volunteer");
  for (const request of requests) {
    const selection = request.searchParams.get("select")!;
    expect(selection).not.toContain("*");
    for (const field of privateFields) expect(selection).not.toContain(field);
  }
});
