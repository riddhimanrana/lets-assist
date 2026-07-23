import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertProvidedLocalSupabaseEnvMatchesStatus,
  assertLocalPostgresUrl,
  assertLocalSupabaseUrl,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
  resolveProvidedLocalSupabaseEnv,
} from "./dv-local-env.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createIsolatedWorkDir(options?: {
  projectId?: string;
  basePort?: number;
  apiPort?: number;
  databasePort?: number;
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "lets-assist-csf-env-"));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, "supabase"));
  const projectId = options?.projectId ?? "lets-assist-csf-browser-test-run";
  const basePort = options?.basePort ?? 56350;
  await writeFile(
    path.join(directory, ".lets-assist-csf-isolated-stack"),
    `project_id=${projectId}\nbase_port=${basePort}\n`,
  );
  await writeFile(
    path.join(directory, "supabase", "config.toml"),
    `project_id = "${projectId}"\n[api]\nport = ${options?.apiPort ?? basePort + 1}\n[db]\nport = ${options?.databasePort ?? basePort + 2}\n`,
  );
  return directory;
}

describe("local Supabase environment resolution", () => {
  test("accepts a complete explicitly provided loopback environment", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-anon",
        SUPABASE_SECRET_KEY: "local-service-role",
        SUPABASE_DB_URL: "postgresql://local-user@127.0.0.1:54322/postgres",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: "local-anon",
      serviceRoleKey: "local-service-role",
      dbUrl: "postgresql://local-user@127.0.0.1:54322/postgres",
    });
  });

  test("fails closed when an explicit Let’s Assist bundle is incomplete", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toThrow("Explicit Let’s Assist Supabase environment is incomplete");
  });

  test("prefers the explicit Let’s Assist environment over unrelated generic values", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "isolated-anon",
        SERVICE_ROLE_KEY: "isolated-service-role",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        SUPABASE_SECRET_KEY: "lets-assist-service-role",
        SUPABASE_DB_URL: "postgresql://local-user@127.0.0.1:54322/postgres",
        DB_URL: "postgresql://vela-user@127.0.0.1:56352/postgres",
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: "lets-assist-anon",
      serviceRoleKey: "lets-assist-service-role",
      dbUrl: "postgresql://local-user@127.0.0.1:54322/postgres",
    });
  });

  test("does not fill an incomplete explicit bundle from a complete ambient bundle", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "vela-anon",
        SERVICE_ROLE_KEY: "vela-service-role",
        DB_URL: "postgresql://vela-user@127.0.0.1:56352/postgres",
      }),
    ).toThrow("Refusing to combine it with another environment source");
  });

  test("rejects a mixed-stack API and database port bundle", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        SUPABASE_SECRET_KEY: "lets-assist-service-role",
        SUPABASE_DB_URL:
          "postgresql://vela-user@127.0.0.1:56352/postgres",
      }),
    ).toThrow("database port must be exactly one greater than the API port");
  });

  test("normalizes localhost and 127.0.0.1 as the same loopback host", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "lets-assist-anon",
        SUPABASE_SECRET_KEY: "lets-assist-service-role",
        SUPABASE_DB_URL:
          "postgresql://local-user@127.0.0.1:54322/postgres",
      }),
    ).toMatchObject({
      url: "http://localhost:54321",
      dbUrl: "postgresql://local-user@127.0.0.1:54322/postgres",
    });
  });

  test("accepts the standard generic environment emitted by Supabase status", () => {
    expect(
      resolveProvidedLocalSupabaseEnv({
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "isolated-anon",
        SERVICE_ROLE_KEY: "isolated-service-role",
        DB_URL: "postgresql://local-user@127.0.0.1:56352/postgres",
      }),
    ).toEqual({
      url: "http://127.0.0.1:56351",
      anonKey: "isolated-anon",
      serviceRoleKey: "isolated-service-role",
      dbUrl: "postgresql://local-user@127.0.0.1:56352/postgres",
    });
  });

  test("fails closed when a generic bundle is incomplete", () => {
    expect(() =>
      resolveProvidedLocalSupabaseEnv({
        API_URL: "http://127.0.0.1:56351",
        ANON_KEY: "isolated-anon",
        SERVICE_ROLE_KEY: "isolated-service-role",
      }),
    ).toThrow("Generic local Supabase environment is incomplete");
  });

  test("returns null only when neither environment family is present", () => {
    expect(resolveProvidedLocalSupabaseEnv({ PATH: "/usr/bin" })).toBeNull();
  });

  test("rejects a provided remote project", () => {
    expect(() => assertLocalSupabaseUrl("https://example.supabase.co")).toThrow(
      "refuses non-local Supabase URL",
    );
  });

  test("accepts only loopback Postgres URLs for database tooling", () => {
    expect(
      assertLocalPostgresUrl("postgresql://local-user@127.0.0.1:56552/postgres"),
    ).toBe("postgresql://local-user@127.0.0.1:56552/postgres");
    expect(() =>
      assertLocalPostgresUrl("postgresql://local-user@example.test/postgres"),
    ).toThrow("refuses non-local Postgres URL");
    expect(() => assertLocalPostgresUrl("https://127.0.0.1:56552/postgres")).toThrow(
      "requires a Postgres URL",
    );
  });

  test("rejects a coherent ambient Vela bundle when it does not match Let’s Assist status", () => {
    const vela = {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "vela-anon",
      SUPABASE_SECRET_KEY: "vela-service-role",
      SUPABASE_DB_URL: "postgresql://postgres@127.0.0.1:55322/postgres",
    };
    const letsAssistStatus = {
      API_URL: "http://127.0.0.1:56551",
      ANON_KEY: "lets-assist-anon",
      PUBLISHABLE_KEY: "lets-assist-publishable",
      SERVICE_ROLE_KEY: "lets-assist-service-role",
      SECRET_KEY: "lets-assist-secret",
      DB_URL: "postgresql://postgres@127.0.0.1:56552/postgres",
    };

    expect(() =>
      assertProvidedLocalSupabaseEnvMatchesStatus(
        vela,
        letsAssistStatus,
        "CSF isolated project lets-assist-csf-browser-test-run",
      ),
    ).toThrow("Refusing an ambient Vela or mixed-stack connection");
  });

  test("CSF service-role tooling rejects a coherent Vela bundle without the generated marker", () => {
    expect(() =>
      getCsfIsolatedSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "vela-anon",
        SUPABASE_SECRET_KEY: "vela-service-role",
        SUPABASE_DB_URL:
          "postgresql://postgres@127.0.0.1:55322/postgres",
      }),
    ).toThrow("requires an explicit generated CSF isolated stack");
  });

  test("accepts only a generated CSF marker whose project and ports match its config", async () => {
    const directory = await createIsolatedWorkDir();
    expect(inspectCsfIsolatedWorkDir(directory)).toMatchObject({
      workDir: await realpath(directory),
      projectId: "lets-assist-csf-browser-test-run",
      apiPort: 56351,
      databasePort: 56352,
    });

    const wrongProject = await createIsolatedWorkDir({ projectId: "vela-dashboard" });
    expect(() => inspectCsfIsolatedWorkDir(wrongProject)).toThrow(
      "invalid project_id",
    );

    const mismatchedPorts = await createIsolatedWorkDir({ apiPort: 55321 });
    expect(() => inspectCsfIsolatedWorkDir(mismatchedPorts)).toThrow(
      "does not match its configured API/database ports",
    );
  });
});
