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
        export { PATCH } from "./implementation";
        export { DELETE as internalDelete } from "./implementation";
      `),
    ).toEqual(["GET", "PATCH", "POST"]);
  });

  test("finds reviewed file-level and inline exported Server Actions", () => {
    expect(
      exportedServerActions(
        `"use server";\nexport async function publishThing() {}\nasync function helper() {}`,
      ),
    ).toEqual([{ name: "publishThing", line: 2 }]);
    expect(
      exportedServerActions(`export async function clientThing() {}`),
    ).toEqual([]);
    expect(
      exportedServerActions(
        `export async function inlineAction() {\n  "use server";\n}\nexport async function ordinaryHelper() {}`,
      ),
    ).toEqual([{ name: "inlineAction", line: 1 }]);
    expect(
      exportedServerActions(
        `"use server";\nexport const arrowAction = async () => {};`,
      ),
    ).toEqual([{ name: "arrowAction", line: 2 }]);
    expect(
      exportedServerActions(
        `"use server";\nexport default async function () {}\nasync function localAction() {}\nexport { localAction as aliasedAction };`,
      ),
    ).toEqual([
      { name: "default", line: 2 },
      { name: "aliasedAction", line: 4 },
    ]);
    expect(
      exportedServerActions(
        `const local = async () => { "use server"; };\nexport { local as default };`,
      ),
    ).toEqual([{ name: "default", line: 2 }]);
    expect(
      exportedServerActions(
        `"use server";\nasync function local() {}\nexport { local };\nexport default local;`,
      ),
    ).toEqual([
      { name: "local", line: 3 },
      { name: "default", line: 4 },
    ]);
    expect(
      exportedServerActions(`export default async () => { "use server"; };`),
    ).toEqual([{ name: "default", line: 1 }]);
    expect(
      exportedServerActions(
        `"use server";\nexport { remoteAction } from "./remote";\nexport * from "./more";`,
      ),
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
      -- SECURITY DEFINER belongs to no function in this comment.
      CREATE FUNCTION implicit_function(p_ratio numeric(5, 2), p_label text DEFAULT 'a(b)')
      RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
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
      expect.objectContaining({
        schema: "unqualified",
        name: "implicit_function",
        arguments: "p_ratio numeric(5, 2), p_label text DEFAULT 'a(b)'",
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
