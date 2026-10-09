import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const sandboxes: string[] = [];
const syntheticPassword = "SYNTHETIC_SECRET_NEVER_PRINT";
const syntheticUrl = `postgresql://synthetic:${syntheticPassword}@example.invalid:5432/test`;

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "supabase-access-audit-"));
  sandboxes.push(root);
  for (const directory of [
    "scripts",
    "supabase",
    "bin",
    "app",
    "components",
    "lib",
  ]) {
    mkdirSync(join(root, directory));
  }
  for (const name of ["architecture", "remote-readiness"]) {
    copyFileSync(
      join(repositoryRoot, `scripts/audit-supabase-${name}.sh`),
      join(root, `scripts/audit-supabase-${name}.sh`),
    );
  }
  writeFileSync(
    join(root, "supabase/config.toml"),
    '[api]\nschemas = ["public", "plugin_data"]\n',
  );
  writeFileSync(
    join(root, "bin/psql"),
    `#!/bin/bash
set -eu
case "\${AUDIT_SCENARIO:-pass}" in
  disconnect) exit 2 ;;
esac
case "$*" in
  *service_only_schema_access*)
    [[ "\${AUDIT_SCENARIO:-}" != schema ]] || echo 'authenticated unexpected schema usage'
    [[ "\${AUDIT_SCENARIO:-}" != service ]] || echo 'service_role missing schema usage'
    ;;
  *service_only_relation_access*)
    [[ "\${AUDIT_SCENARIO:-}" != relation ]] || echo 'anon synthetic_table'
    [[ "\${AUDIT_SCENARIO:-}" != query-error ]] || exit 2
    ;;
  *service_only_sequence_access*)
    [[ "\${AUDIT_SCENARIO:-}" != sequence ]] || echo 'authenticated synthetic_sequence'
    ;;
  *plugin_runtime_contracts*)
    [[ "\${AUDIT_SCENARIO:-}" != contract ]] || echo 'synthetic-plugin rls-client'
    ;;
esac
exit 0
`,
    { mode: 0o700 },
  );
  return root;
}

function audit(root: string, scenario = "pass", name = "remote-readiness") {
  const result = spawnSync(
    "bash",
    ["-x", join(root, `scripts/audit-supabase-${name}.sh`)],
    {
      env: {
        ...process.env,
        SUPABASE_DB_URL: syntheticUrl,
        AUDIT_SCENARIO: scenario,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
      },
      encoding: "utf8",
    },
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const directory of sandboxes.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Supabase audit confidentiality and service-only access", () => {
  for (const name of ["architecture", "remote-readiness"]) {
    test(`${name} withholds credentials on connection failure even with shell tracing`, () => {
      const result = audit(sandbox(), "disconnect", name);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("Connection details are withheld.");
      expect(result.output).not.toContain(syntheticPassword);
      expect(result.output).not.toContain(syntheticUrl);
    });
  }

  test("the approved service-only model passes without claiming hosted readiness", () => {
    const result = audit(sandbox());
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "Supabase service-only access contract passed",
    );
    expect(result.output).toContain(
      "Hosted deployment and runtime acceptance remain separate checks.",
    );
    expect(result.output).not.toContain(syntheticPassword);
  });

  for (const scenario of [
    "schema",
    "service",
    "relation",
    "sequence",
    "contract",
    "query-error",
  ]) {
    test(`the ${scenario} violation fails closed`, () => {
      const result = audit(sandbox(), scenario);
      expect(result.status).not.toBe(0);
      expect(result.output).not.toContain("contract passed");
      expect(result.output).not.toContain(syntheticPassword);
    });
  }

  test("removing the schema required by the server helper fails", () => {
    const root = sandbox();
    writeFileSync(
      join(root, "supabase/config.toml"),
      '[api]\nschemas = ["public"]\n',
    );
    const result = audit(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("plugin_data is missing from api.schemas");
  });

  test("a direct app schema builder fails while the approved helper is allowed", () => {
    const root = sandbox();
    mkdirSync(join(root, "lib/plugins"));
    writeFileSync(
      join(root, "lib/plugins/supabase.ts"),
      'client.schema("plugin_data");\n',
    );
    expect(audit(root).status).toBe(0);
    writeFileSync(
      join(root, "app/unsafe.ts"),
      'client.schema("plugin_data");\n',
    );
    const result = audit(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("app/unsafe.ts");
  });

  test("an unavailable source directory cannot silently pass", () => {
    const root = sandbox();
    rmSync(join(root, "app"), { recursive: true });
    const result = audit(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Unable to scan source access boundaries.");
  });
});
