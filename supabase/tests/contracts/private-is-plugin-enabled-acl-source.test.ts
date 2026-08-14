import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const migrationName = "20260813085442_harden_private_is_plugin_enabled_acl.sql";
const migration = readFileSync(
  join(repositoryRoot, "supabase/migrations", migrationName),
  "utf8",
);
const originalDefinition = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260412000001_create_plugin_data_schema.sql",
  ),
  "utf8",
);
const pgTap = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/private_is_plugin_enabled_acl.test.sql",
  ),
  "utf8",
);

const searchableExtensions = new Set([".js", ".mjs", ".sql", ".ts", ".tsx"]);

function currentCallers() {
  const ignored = new Set([
    "supabase/migrations/20260412000001_create_plugin_data_schema.sql",
    `supabase/migrations/${migrationName}`,
    "supabase/tests/contracts/private-is-plugin-enabled-acl-source.test.ts",
    "supabase/tests/database/private_is_plugin_enabled_acl.test.sql",
  ]);

  return ["app", "lib", "services", "supabase"]
    .flatMap((root) =>
      readdirSync(join(repositoryRoot, root), {
        encoding: "utf8",
        recursive: true,
        withFileTypes: false,
      }).map((name) => join(root, name)),
    )
    .filter(
      (name) =>
        searchableExtensions.has(extname(name)) &&
        !ignored.has(name) &&
        readFileSync(join(repositoryRoot, name), "utf8").includes(
          "is_plugin_enabled",
        ),
    )
    .sort();
}

describe("private.is_plugin_enabled ACL source contract", () => {
  test("keeps the existing definer on an empty search path without replacing it", () => {
    const definition =
      /CREATE OR REPLACE FUNCTION private\.is_plugin_enabled[\s\S]*?\$\$;/u.exec(
        originalDefinition,
      )?.[0];

    expect(definition).toContain("SECURITY DEFINER");
    expect(definition).toContain("SET search_path = ''");
    expect(migration).not.toContain(
      "CREATE OR REPLACE FUNCTION private.is_plugin_enabled",
    );
  });

  test("proves there is no runtime caller requiring a service-role grant", () => {
    expect(currentCallers()).toEqual([]);
  });

  test("makes the unused helper owner-only with explicit browser and server revokes", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION private.is_plugin_enabled(uuid, text)",
    );
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION private.is_plugin_enabled(uuid, text)",
    );
    expect(migration).toContain("TO postgres;");
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION private\.is_plugin_enabled\(uuid, text\)\s+TO (?:anon|authenticated|service_role)/u,
    );
  });

  test("ships an exact runtime ACL and definition pgTAP plan", () => {
    const declared = Number(/extensions\.plan\((\d+)\)/u.exec(pgTap)?.[1]);
    const actual = [
      ...pgTap.matchAll(/SELECT\s+extensions\.(?!plan\b|finish\b)\w+\s*\(/giu),
    ].length;

    expect({ actual, declared }).toEqual({ actual: 8, declared: 8 });
  });
});
