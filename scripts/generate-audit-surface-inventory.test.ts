import { describe, expect, test } from "bun:test";

import {
  exportedServerActions,
  routeMethods,
  rpcCallSites,
  sqlFunctionDefinitions,
  sqlPolicies,
} from "./generate-audit-surface-inventory.mjs";

describe("audit surface inventory parser", () => {
  test("finds route methods without treating internal helpers as handlers", () => {
    expect(
      routeMethods(`
        async function GET() {}
        export async function POST() {}
        const handler = async () => {};
        export { handler as GET };
      `),
    ).toEqual(["GET", "POST"]);
  });

  test("requires a file-level server directive and exported async functions", () => {
    expect(
      exportedServerActions(
        `"use server";\nexport async function publishThing() {}\nasync function helper() {}`,
      ),
    ).toEqual([{ name: "publishThing", line: 2 }]);
    expect(
      exportedServerActions(`export async function clientThing() {}`),
    ).toEqual([]);
  });

  test("records named RPC call sites", () => {
    expect(
      rpcCallSites(`await client.rpc("publish_hours", { value: 1 });`),
    ).toEqual([{ name: "publish_hours", line: 1 }]);
  });

  test("classifies SQL function security and policy identities", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION public.safe_rpc(p_id uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN '{}'::jsonb; END $$;
      CREATE FUNCTION public.trigger_only()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE POLICY "tenant reads" ON plugin_data.records FOR SELECT USING (true);
    `;
    expect(sqlFunctionDefinitions(sql, "migration.sql")).toEqual([
      expect.objectContaining({
        schema: "public",
        name: "safe_rpc",
        securityDefiner: true,
      }),
      expect.objectContaining({
        schema: "public",
        name: "trigger_only",
        securityDefiner: false,
      }),
    ]);
    expect(sqlPolicies(sql, "migration.sql")).toEqual([
      expect.objectContaining({
        name: "tenant reads",
        schema: "plugin_data",
        table: "records",
      }),
    ]);
  });
});
