import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function readRepositoryFile(name: string) {
  return readFileSync(join(repositoryRoot, name), "utf8");
}

function flow(text: string) {
  return text.replace(/\s+/gu, " ");
}

const platform = flow(readRepositoryFile("docs/architecture/platform.md"));
const data = flow(readRepositoryFile("docs/architecture/data.md"));
const testing = flow(readRepositoryFile("docs/development/testing.md"));
const supabaseConfig = readRepositoryFile("supabase/config.toml");
const migrationLedger = readdirSync(join(repositoryRoot, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) =>
    readFileSync(join(repositoryRoot, "supabase/migrations", name), "utf8"),
  )
  .join("\n");

describe("architecture security documentation contract", () => {
  test("describes each browser boundary without the former private-schema absolute", () => {
    expect(platform).toContain(
      "The browser has no access to `plugin_data` or the private CSF implementation",
    );
    expect(platform).toContain(
      "`private` and `app_private` are omitted from PostgREST's exposed schemas",
    );
    expect(platform).toContain(
      "reviewed browser reads in `public` remain subject to RLS",
    );
    expect(platform).not.toContain(
      "There is no browser path to private schemas",
    );

    const exposedSchemas =
      /^schemas\s*=\s*\[([^\]]+)\]/mu.exec(supabaseConfig)?.[1] ?? "";
    expect(exposedSchemas).toContain('"plugin_data"');
    expect(exposedSchemas).not.toContain('"private"');
    expect(exposedSchemas).not.toContain('"app_private"');
  });

  test("keeps hosted Development Google auth enabled without committing its secret", () => {
    const developmentGoogle = supabaseConfig.slice(
      supabaseConfig.indexOf("[remotes.development.auth.external.google]"),
      supabaseConfig.indexOf("[api]"),
    );

    expect(developmentGoogle).toContain("enabled = true");
    expect(developmentGoogle).toMatch(
      /client_id = "[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com"/u,
    );
    expect(developmentGoogle).toContain(
      'redirect_uri = "https://ocbuygudvarsuxijxhau.supabase.co/auth/v1/callback"',
    );
    expect(developmentGoogle).toContain('secret = ""');
    expect(developmentGoogle).not.toContain("GOCSPX-");
    expect(developmentGoogle).toContain("skip_nonce_check = false");
  });

  test("states and evidences the different schema security obligations", () => {
    expect(data).toContain(
      "Never grant `plugin_data` schema usage to `PUBLIC`, `anon`, or `authenticated`",
    );
    expect(data).toContain(
      "Repository policy requires every function in `private` or `app_private` to carry explicit per-object execution revokes and reviewed grants",
    );
    expect(data).toContain(
      "The DV student and household helpers retain `authenticated` execution only because authenticated DV policies call them",
    );

    expect(migrationLedger).toContain(
      "REVOKE ALL ON SCHEMA plugin_data FROM PUBLIC, anon, authenticated;",
    );
    expect(migrationLedger).toContain(
      "REVOKE ALL ON FUNCTION private.is_plugin_enabled(uuid, text)",
    );
    expect(migrationLedger).toContain(
      "REVOKE ALL ON FUNCTION private.is_dv_student(uuid)",
    );
    expect(migrationLedger).toContain(
      "REVOKE ALL ON FUNCTION private.can_access_dv_household(uuid)",
    );
    expect(migrationLedger).toMatch(
      /REVOKE ALL ON FUNCTION app_private\.[^(]+\([^;]+FROM PUBLIC, anon, authenticated/u,
    );
  });

  test("keeps evidence tiers separate and scale numbers as targets rather than results", () => {
    expect(testing).toContain(
      "A local pass is not a deployment, a static inventory is not a runtime gate",
    );
    expect(testing).toContain(
      "only checks run against the hosted Development database and exact deployed application SHA belong in this class",
    );
    expect(testing).toContain(
      "no Production database, application, browser, worker, or provider gate was run",
    );
    expect(testing).toContain(
      "These are acceptance targets for a release that claims the corresponding scale, not completed evidence",
    );
    expect(testing).toContain(
      "The `csf:test:scale` command is a 1,000-profile/600-application smoke test with timings but no thresholds",
    );
    expect(testing).toContain(
      "The `csf:test:import:scale` command exercises the real 1,000-row import receipt path in one hundred 10-row batches",
    );
  });
});
