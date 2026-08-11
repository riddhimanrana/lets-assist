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
  for (const match of source.matchAll(declaration)) methods.add(match[1]);
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/gu)) {
    for (const rawSpecifier of block[1].split(",")) {
      const specifier = rawSpecifier.trim();
      const alias = specifier.match(
        /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u,
      );
      const exportedName = alias?.[2] ?? specifier;
      if (HTTP_METHODS.includes(exportedName)) methods.add(exportedName);
    }
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
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:("(?:[^"]|"")*"|[A-Za-z_][\w$]*)\s*\.\s*)?("(?:[^"]|"")*"|[A-Za-z_][\w$]*)\s*\(/giu;
  for (const match of source.matchAll(pattern)) {
    const argumentsStart = match.index + match[0].length;
    const argumentsEnd = closingParenthesis(source, argumentsStart);
    if (argumentsEnd < 0) continue;
    const afterArguments = source.slice(argumentsEnd + 1);
    const bodyStart = afterArguments.search(
      /\bAS\s+(?:\$[A-Za-z0-9_]*\$|['"])/iu,
    );
    const headerEnd =
      bodyStart >= 0
        ? argumentsEnd + 1 + bodyStart
        : argumentsEnd + 1 + Math.max(0, afterArguments.indexOf(";"));
    const header = source.slice(match.index, headerEnd);
    definitions.push({
      schema: match[1]?.replaceAll('"', "") ?? "unqualified",
      name: match[2].replaceAll('"', ""),
      arguments: compact(source.slice(argumentsStart, argumentsEnd)),
      securityDefiner: /\bSECURITY\s+DEFINER\b/iu.test(header),
      file,
      line: lineNumber(source, match.index),
    });
  }
  return definitions;
}

function closingParenthesis(source, start) {
  let depth = 1;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function privatePluginCommit(root) {
  const pluginPath = resolve(root, "lib/plugins/private");
  const gitlink = execFileSync(
    "git",
    ["ls-tree", "HEAD", "lib/plugins/private"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const gitlinkMatch = gitlink.match(/^160000\s+commit\s+([0-9a-f]{40})\s+/u);
  if (!gitlinkMatch) {
    throw new Error("Private plugin gitlink is missing from the root commit.");
  }

  let pluginTopLevel;
  let pluginHead;
  try {
    pluginTopLevel = execFileSync(
      "git",
      ["-C", pluginPath, "rev-parse", "--show-toplevel"],
      { cwd: root, encoding: "utf8" },
    ).trim();
    pluginHead = execFileSync("git", ["-C", pluginPath, "rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(
      "Private plugin submodule is not initialized; run bun run plugin:submodules:init.",
    );
  }

  if (resolve(pluginTopLevel) !== pluginPath) {
    throw new Error(
      "Private plugin path is not an initialized standalone submodule worktree.",
    );
  }
  if (pluginHead !== gitlinkMatch[1]) {
    throw new Error(
      `Private plugin HEAD ${pluginHead} does not match root gitlink ${gitlinkMatch[1]}.`,
    );
  }
  return pluginHead;
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
      privatePluginCommit: privatePluginCommit(root),
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
