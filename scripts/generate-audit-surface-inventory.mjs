#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
const SOURCE_GLOBS = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
  "services/**/*.{ts,tsx}",
];
const IGNORE = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/node_modules/**",
  ".artifacts/**",
];

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function compact(value) {
  return value.replace(/\s+/gu, " ").trim();
}

export function routeMethods(source) {
  const methods = new Set();
  const declaration = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const)\\s+(${HTTP_METHODS.join("|")})\\b`,
    "gu",
  );
  const alias = new RegExp(
    `export\\s*\\{[^}]*\\bas\\s+(${HTTP_METHODS.join("|")})\\b[^}]*\\}`,
    "gu",
  );
  for (const expression of [declaration, alias]) {
    for (const match of source.matchAll(expression)) methods.add(match[1]);
  }
  return [...methods].sort();
}

export function exportedServerActions(source) {
  if (!/^\s*["']use server["'];/u.test(source)) return [];
  const actions = [];
  const pattern = /export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/gu;
  for (const match of source.matchAll(pattern)) {
    actions.push({ name: match[1], line: lineNumber(source, match.index) });
  }
  return actions;
}

export function rpcCallSites(source) {
  const calls = [];
  const pattern = /\.rpc\(\s*["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) {
    calls.push({ name: match[1], line: lineNumber(source, match.index) });
  }
  return calls;
}

export function sqlFunctionDefinitions(source, file) {
  const definitions = [];
  const pattern =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w"]+)\.([\w"]+)\s*\(([^)]*)\)/giu;
  const matches = [...source.matchAll(pattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const end = matches[index + 1]?.index ?? source.length;
    const definition = source.slice(match.index, end);
    definitions.push({
      schema: match[1].replaceAll('"', ""),
      name: match[2].replaceAll('"', ""),
      arguments: compact(match[3]),
      securityDefiner: /\bSECURITY\s+DEFINER\b/iu.test(definition),
      file,
      line: lineNumber(source, match.index),
    });
  }
  return definitions;
}

export function sqlPolicies(source, file) {
  const policies = [];
  const pattern =
    /CREATE\s+POLICY\s+(?:"([^"]+)"|([\w]+))\s+ON\s+(?:"?([\w]+)"?\.)?"?([\w]+)"?/giu;
  for (const match of source.matchAll(pattern)) {
    policies.push({
      name: match[1] ?? match[2],
      schema: match[3] ?? "public",
      table: match[4],
      file,
      line: lineNumber(source, match.index),
    });
  }
  return policies;
}

function boundaryKinds(file, source) {
  const kinds = [];
  if (/\/api\/cron\//u.test(file)) kinds.push("cron");
  if (/\/api\/(?:webhooks?|resend\/webhook)\//u.test(file))
    kinds.push("webhook");
  if (/\/callback\//u.test(file)) kinds.push("oauth-callback");
  if (/\.upload\s*\(|\bformData\s*\(|multipart\/form-data/iu.test(source))
    kinds.push("upload");
  if (/\b(?:pdf-lib|pdfjs|jszip|xlsx|sharp)\b/iu.test(source))
    kinds.push("file-processing");
  return [...new Set(kinds)].sort();
}

function collectMatches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => ({
    match: compact(match[0]).slice(0, 160),
    line: lineNumber(source, match.index),
  }));
}

function sortByFileLine(left, right) {
  return left.file.localeCompare(right.file) || left.line - right.line;
}

export async function buildSurfaceInventory(rootDirectory) {
  const root = resolve(rootDirectory);
  const sourceFiles = await fg(SOURCE_GLOBS, {
    cwd: root,
    ignore: IGNORE,
    onlyFiles: true,
    unique: true,
  });
  const routeFiles = await fg(
    ["app/**/route.ts", "lib/plugins/private/**/route.ts"],
    {
      cwd: root,
      ignore: IGNORE,
      onlyFiles: true,
    },
  );
  const migrationFiles = await fg(["supabase/migrations/*.sql"], {
    cwd: root,
    onlyFiles: true,
  });

  const routeHandlers = [];
  const serverActions = [];
  const rpcCalls = [];
  const serviceRoleCalls = [];
  const privilegedBoundaries = [];

  for (const file of sourceFiles.sort()) {
    const source = readFileSync(join(root, file), "utf8");
    for (const action of exportedServerActions(source))
      serverActions.push({ file, ...action });
    for (const rpc of rpcCallSites(source)) rpcCalls.push({ file, ...rpc });
    for (const finding of collectMatches(
      source,
      /\b(?:createAdminClient|createServiceRoleClient|SUPABASE_(?:SERVICE_ROLE_KEY|SECRET_KEY)|SERVICE_ROLE_KEY)\b/gu,
    )) {
      serviceRoleCalls.push({ file, ...finding });
    }
    const kinds = boundaryKinds(file, source);
    if (kinds.length > 0) privilegedBoundaries.push({ file, kinds });
  }

  for (const file of routeFiles.sort()) {
    const source = readFileSync(join(root, file), "utf8");
    routeHandlers.push({
      file,
      route: file.startsWith("app/")
        ? `/${file.slice("app/".length, -"/route.ts".length)}`.replace(
            /\/\(.*?\)/gu,
            "",
          )
        : null,
      methods: routeMethods(source),
      boundaryKinds: boundaryKinds(file, source),
    });
  }

  const sqlFunctions = [];
  const rlsPolicies = [];
  const storageBuckets = new Map();
  for (const file of migrationFiles.sort()) {
    const source = readFileSync(join(root, file), "utf8");
    sqlFunctions.push(...sqlFunctionDefinitions(source, file));
    rlsPolicies.push(...sqlPolicies(source, file));
    const bucketPattern =
      /INSERT\s+INTO\s+(?:"?storage"?\.)?"?buckets"?[\s\S]*?(?:ON\s+CONFLICT|;)/giu;
    for (const block of source.matchAll(bucketPattern)) {
      const candidatePattern = /\(\s*'([a-z0-9][a-z0-9_-]{1,80})'\s*,\s*'\1'/gu;
      for (const candidate of block[0].matchAll(candidatePattern)) {
        const id = candidate[1];
        if (!storageBuckets.has(id)) {
          storageBuckets.set(id, {
            id,
            file,
            line: lineNumber(source, block.index),
          });
        }
      }
    }
  }

  const securityDefinerFunctions = sqlFunctions.filter(
    (entry) => entry.securityDefiner,
  );
  const inventory = {
    schemaVersion: 1,
    provenance: {
      repositoryRoot: root,
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      privatePluginCommit: execFileSync(
        "git",
        ["-C", "lib/plugins/private", "rev-parse", "HEAD"],
        {
          cwd: root,
          encoding: "utf8",
        },
      ).trim(),
      evidenceClass: "static-source-inventory",
      environment: "local-read-only",
    },
    summary: {
      routeHandlers: routeHandlers.length,
      serverActions: serverActions.length,
      rpcCallSites: rpcCalls.length,
      sqlFunctions: sqlFunctions.length,
      securityDefinerFunctions: securityDefinerFunctions.length,
      rlsPolicies: rlsPolicies.length,
      storageBuckets: storageBuckets.size,
      cronRoutes: routeHandlers.filter((entry) =>
        entry.boundaryKinds.includes("cron"),
      ).length,
      webhookRoutes: routeHandlers.filter((entry) =>
        entry.boundaryKinds.includes("webhook"),
      ).length,
      oauthCallbacks: privilegedBoundaries.filter((entry) =>
        entry.kinds.includes("oauth-callback"),
      ).length,
      uploadBoundaries: privilegedBoundaries.filter((entry) =>
        entry.kinds.includes("upload"),
      ).length,
      fileProcessingBoundaries: privilegedBoundaries.filter((entry) =>
        entry.kinds.includes("file-processing"),
      ).length,
      serviceRoleReferences: serviceRoleCalls.length,
    },
    routeHandlers,
    serverActions: serverActions.sort(sortByFileLine),
    rpcCallSites: rpcCalls.sort(sortByFileLine),
    sqlFunctions,
    securityDefinerFunctions,
    rlsPolicies,
    storageBuckets: [...storageBuckets.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    privilegedBoundaries: privilegedBoundaries.sort((left, right) =>
      left.file.localeCompare(right.file),
    ),
    serviceRoleReferences: serviceRoleCalls.sort(sortByFileLine),
  };
  return inventory;
}

function markdownSummary(inventory) {
  const rows = Object.entries(inventory.summary)
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join("\n");
  return `# Repository audit surface inventory\n\n- Evidence class: ${inventory.provenance.evidenceClass}\n- Environment: ${inventory.provenance.environment}\n- Root commit: ${inventory.provenance.gitCommit}\n- Private plugin commit: ${inventory.provenance.privatePluginCommit}\n\n| Surface | Count |\n| --- | ---: |\n${rows}\n\nThis is a static source inventory, not proof that a route is reachable or that a database grant is effective. Runtime catalog and hosted Development verification are separate gates.\n`;
}

async function main() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDirectory, "..");
  const outputDirectory = resolve(
    root,
    process.argv[2] ?? ".artifacts/audit/surface-inventory",
  );
  const inventory = await buildSurfaceInventory(root);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, "surface-inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDirectory, "surface-inventory.md"),
    markdownSummary(inventory),
  );
  console.log(
    `Wrote static audit inventory to ${relative(root, outputDirectory)}`,
  );
  console.log(JSON.stringify(inventory.summary, null, 2));
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  await main();
