import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  discoverPrivateApplicationPackages,
  scrubPrivilegedPluginAppEnvironment,
  validatePrivateApplicationPackage,
} from "./check-private-application-packages.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(overrides = {}) {
  const privateRoot = mkdtempSync(join(tmpdir(), "private-plugin-apps-"));
  temporaryRoots.push(privateRoot);
  const appRoot = join(privateRoot, "apps", "example");
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(join(appRoot, "bun.lock"), "");
  const defaultScripts = {
    lint: "eslint .",
    typecheck: "tsc --noEmit",
    test: "bun test",
    build: "next build",
    "audit:data-access": "node scripts/audit-data-access.mjs",
    "inventory:routes": "node scripts/inventory-routes.mjs",
  };
  writeFileSync(
    join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@lets-assist/example-plugin-app",
        private: true,
        packageManager: "bun@1.3.14",
        ...overrides,
        scripts: { ...defaultScripts, ...overrides.scripts },
      },
      null,
      2,
    )}\n`,
  );
  return { privateRoot, appRoot };
}

test("discovers application packages without scanning plugin implementation trees", () => {
  const { privateRoot, appRoot } = fixture();
  mkdirSync(join(privateRoot, "plugins", "example"), { recursive: true });
  assert.deepEqual(discoverPrivateApplicationPackages(privateRoot), [appRoot]);
});

test("accepts a child app that owns every required quality and security gate", () => {
  const { appRoot } = fixture();
  const result = validatePrivateApplicationPackage(appRoot, "bun@1.3.14");
  assert.equal(result.label, "example");
  assert.equal(result.lockfile, "bun.lock");
});

test("fails closed when the child omits its browser data-access audit", () => {
  const { appRoot } = fixture({
    scripts: { "audit:data-access": undefined },
  });
  assert.throws(
    () => validatePrivateApplicationPackage(appRoot, "bun@1.3.14"),
    /must define the audit:data-access script/u,
  );
});

test("rejects privileged Supabase keys even in an example environment file", () => {
  const { appRoot } = fixture();
  writeFileSync(join(appRoot, ".env.example"), "SUPABASE_SECRET_KEY=never\n");
  assert.throws(
    () => validatePrivateApplicationPackage(appRoot, "bun@1.3.14"),
    /must not declare SUPABASE_SECRET_KEY/u,
  );
});

test("scrubs privileged keys before running any child-owned command", () => {
  const environment = scrubPrivilegedPluginAppEnvironment({
    PATH: "/bin",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
  });
  assert.equal(environment.PATH, "/bin");
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "publishable");
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(environment.SUPABASE_SECRET_KEY, undefined);
});
