#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SCRIPTS = [
  "lint",
  "typecheck",
  "test",
  "build",
  "audit:data-access",
  "inventory:routes",
];
const PRIVILEGED_ENV_NAME =
  /(?:^|_)(?:ACCESS_TOKEN|API_KEY|DATABASE_URL|DB_URL|PASSWORD|PRIVATE_KEY|SECRET|SECRET_KEY|SERVICE_ROLE_KEY|TOKEN)$/u;
const SAFE_CHILD_ENV_NAMES = new Set([
  "CI",
  "GITHUB_ACTIONS",
  "HOME",
  "LANG",
  "LC_ALL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_TELEMETRY_DISABLED",
  "NODE_ENV",
  "PATH",
  "RUNNER_ARCH",
  "RUNNER_OS",
  "SHELL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
]);
const LOCKFILES = ["bun.lock", "bun.lockb"];

function isPrivilegedEnvName(name) {
  return !name.startsWith("NEXT_PUBLIC_") && PRIVILEGED_ENV_NAME.test(name);
}

function fail(message) {
  throw new Error(`[plugin-apps] ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Could not read ${path}: ${error.message}`);
  }
}

export function discoverPrivateApplicationPackages(privateRoot) {
  const appsRoot = join(privateRoot, "apps");
  if (!existsSync(appsRoot)) return [];

  return readdirSync(appsRoot)
    .map((entry) => join(appsRoot, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort();
}

export function validatePrivateApplicationPackage(
  appRoot,
  expectedPackageManager,
) {
  const label = basename(appRoot);
  const packagePath = join(appRoot, "package.json");
  if (!existsSync(packagePath)) fail(`${label} has no package.json.`);

  const packageJson = readJson(packagePath);
  if (packageJson.private !== true) {
    fail(`${label} must set package.json private to true.`);
  }
  if (packageJson.packageManager !== expectedPackageManager) {
    fail(
      `${label} must pin packageManager ${expectedPackageManager}; found ${packageJson.packageManager ?? "nothing"}.`,
    );
  }

  const lockfiles = LOCKFILES.filter((name) => existsSync(join(appRoot, name)));
  if (lockfiles.length !== 1) {
    fail(
      `${label} must own exactly one Bun lockfile; found ${lockfiles.length}.`,
    );
  }

  for (const script of REQUIRED_SCRIPTS) {
    if (typeof packageJson.scripts?.[script] !== "string") {
      fail(`${label} must define the ${script} script.`);
    }
  }

  for (const entry of readdirSync(appRoot).filter((name) =>
    name.startsWith(".env"),
  )) {
    const contents = readFileSync(join(appRoot, entry), "utf8");
    for (const line of contents.split(/\r?\n/u)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(
        line,
      );
      if (match && isPrivilegedEnvName(match[1])) {
        fail(`${label}/${entry} must not declare ${match[1]}.`);
      }
    }
  }

  return { appRoot, label, packageJson, lockfile: lockfiles[0] };
}

function run(app, command, args, environment) {
  process.stdout.write(
    `[plugin-apps] ${app.label}: ${command} ${args.join(" ")}\n`,
  );
  const result = spawnSync(command, args, {
    cwd: app.appRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${app.label} failed ${command} ${args.join(" ")}.`);
  }
}

export function scrubPrivilegedPluginAppEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => SAFE_CHILD_ENV_NAMES.has(name) && value !== undefined,
    ),
  );
}

export function runPrivateApplicationGates(app, environment = process.env) {
  const scrubbed = scrubPrivilegedPluginAppEnvironment(environment);
  run(app, "bun", ["--no-env-file", "install", "--frozen-lockfile"], scrubbed);
  for (const script of REQUIRED_SCRIPTS) {
    run(app, "bun", ["--no-env-file", "run", script], scrubbed);
  }
}

function parseArguments(arguments_) {
  let privateRoot = resolve("lib/plugins/private");
  let contractOnly = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--contract-only") {
      contractOnly = true;
    } else if (argument === "--private-root") {
      const value = arguments_[index + 1];
      if (!value) fail("--private-root requires a path.");
      privateRoot = resolve(value);
      index += 1;
    } else {
      fail(`Unknown argument ${argument}.`);
    }
  }
  return { privateRoot, contractOnly };
}

export function main(arguments_ = process.argv.slice(2)) {
  const { privateRoot, contractOnly } = parseArguments(arguments_);
  const rootPackage = readJson(resolve("package.json"));
  const expectedPackageManager = rootPackage.packageManager;
  if (
    typeof expectedPackageManager !== "string" ||
    !expectedPackageManager.startsWith("bun@")
  ) {
    fail("The platform package.json must pin Bun through packageManager.");
  }

  const appRoots = discoverPrivateApplicationPackages(privateRoot);
  const apps = appRoots.map((appRoot) =>
    validatePrivateApplicationPackage(appRoot, expectedPackageManager),
  );

  if (!contractOnly) {
    for (const app of apps) runPrivateApplicationGates(app);
  }

  process.stdout.write(
    `[plugin-apps] PASS: ${apps.length} private application package${apps.length === 1 ? "" : "s"} ${contractOnly ? "satisfy the ownership contract" : "passed independent gates"}.\n`,
  );
}

const isEntrypoint = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isEntrypoint) main();
