#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import ts from "typescript";

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
  "lib/plugins/private/apps/**",
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

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ??
        false)
    : false;
}

function beginsWithDirective(statements, directive) {
  for (const statement of statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === directive) return true;
  }
  return false;
}

export function exportedServerActions(source, file = "source.ts") {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const fileLevel = beginsWithDirective(sourceFile.statements, "use server");
  const actions = [];
  const localActions = new Set();

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword) &&
      (fileLevel ||
        (statement.body &&
          beginsWithDirective(statement.body.statements, "use server")))
    ) {
      localActions.add(statement.name.text);
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer)) &&
          hasModifier(initializer, ts.SyntaxKind.AsyncKeyword) &&
          (fileLevel ||
            (ts.isBlock(initializer.body) &&
              beginsWithDirective(initializer.body.statements, "use server")))
        ) {
          localActions.add(declaration.name.text);
        }
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.AsyncKeyword) &&
      (fileLevel ||
        (statement.body &&
          beginsWithDirective(statement.body.statements, "use server")))
    ) {
      actions.push({
        name: hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
          ? "default"
          : (statement.name?.text ?? "default"),
        line:
          sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line +
          1,
      });
      continue;
    }

    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (
          !ts.isIdentifier(declaration.name) ||
          !initializer ||
          (!ts.isArrowFunction(initializer) &&
            !ts.isFunctionExpression(initializer)) ||
          !hasModifier(initializer, ts.SyntaxKind.AsyncKeyword) ||
          (!fileLevel &&
            (!ts.isBlock(initializer.body) ||
              !beginsWithDirective(initializer.body.statements, "use server")))
        ) {
          continue;
        }

        actions.push({
          name: declaration.name.text,
          line:
            sourceFile.getLineAndCharacterOfPosition(statement.getStart())
              .line + 1,
        });
      }
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = element.propertyName?.text ?? element.name.text;
        if (!localActions.has(localName)) continue;
        actions.push({
          name: element.name.text,
          line:
            sourceFile.getLineAndCharacterOfPosition(element.getStart()).line +
            1,
        });
      }
    }

    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ((ts.isIdentifier(statement.expression) &&
        localActions.has(statement.expression.text)) ||
        ((ts.isArrowFunction(statement.expression) ||
          ts.isFunctionExpression(statement.expression)) &&
          hasModifier(statement.expression, ts.SyntaxKind.AsyncKeyword) &&
          (fileLevel ||
            (ts.isBlock(statement.expression.body) &&
              beginsWithDirective(
                statement.expression.body.statements,
                "use server",
              )))))
    ) {
      actions.push({
        name: "default",
        line:
          sourceFile.getLineAndCharacterOfPosition(statement.getStart()).line +
          1,
      });
    }
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

function sourceLine(sourceFile, node) {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function isAdminClientModule(moduleName, file) {
  const resolvedModule = moduleName.startsWith(".")
    ? resolve(dirname(file), moduleName).replaceAll("\\", "/")
    : moduleName;
  return /(?:^|\/)supabase\/admin$/u.test(resolvedModule);
}

export function serviceRoleReferences(source, file = "source.ts") {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references = [];
  const factoryLocals = new Map();
  const namespaceLocals = new Set();

  function record(kind, name, localName, node) {
    references.push({
      kind,
      name,
      localName,
      match: compact(node.getText(sourceFile)).slice(0, 160),
      line: sourceLine(sourceFile, node),
    });
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      isAdminClientModule(statement.moduleSpecifier.text, file)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName !== "getAdminClient") continue;
          factoryLocals.set(element.name.text, "getAdminClient");
          record(
            "factory-import",
            "getAdminClient",
            element.name.text,
            element,
          );
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceLocals.add(bindings.name.text);
        record(
          "factory-import",
          "getAdminClient",
          `${bindings.name.text}.getAdminClient`,
          bindings,
        );
      }
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "getAdminClient"
    ) {
      factoryLocals.set("getAdminClient", "getAdminClient");
      record(
        "factory-definition",
        "getAdminClient",
        "getAdminClient",
        statement.name,
      );
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isIdentifier(declaration.initializer) &&
          factoryLocals.has(declaration.initializer.text)
        ) {
          factoryLocals.set(declaration.name.text, "getAdminClient");
        }
      }
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        factoryLocals.has(node.expression.text)
      ) {
        record("factory-call", "getAdminClient", node.expression.text, node);
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "getAdminClient" &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceLocals.has(node.expression.expression.text)
      ) {
        record(
          "factory-call",
          "getAdminClient",
          node.expression.getText(sourceFile),
          node,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const finding of collectMatches(
    source,
    /\b(?:SUPABASE_(?:SERVICE_ROLE_KEY|SECRET_KEY)|SERVICE_ROLE_KEY)\b/gu,
  )) {
    references.push({
      kind: "credential-reference",
      name: finding.match,
      localName: finding.match,
      ...finding,
    });
  }

  return references.sort(
    (left, right) =>
      left.line - right.line || left.kind.localeCompare(right.kind),
  );
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
    ["ls-files", "--stage", "lib/plugins/private"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const gitlinkMatch = gitlink.match(/^160000\s+([0-9a-f]{40})\s+0\s+/u);
  if (!gitlinkMatch) {
    throw new Error("Private plugin gitlink is missing from the root index.");
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
      `Private plugin HEAD ${pluginHead} does not match root index gitlink ${gitlinkMatch[1]}.`,
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
  const inventoryInputFiles = [
    ...new Set([...sourceFiles, ...routeFiles, ...migrationFiles]),
  ].sort();
  const inventoryInputHash = createHash("sha256");
  for (const file of inventoryInputFiles) {
    inventoryInputHash.update(file);
    inventoryInputHash.update("\0");
    inventoryInputHash.update(readFileSync(join(root, file)));
    inventoryInputHash.update("\0");
  }

  const routeHandlers = [];
  const serverActions = [];
  const rpcCalls = [];
  const serviceRoleCalls = [];
  const privilegedBoundaries = [];

  for (const file of sourceFiles.sort()) {
    const source = readFileSync(join(root, file), "utf8");
    for (const action of exportedServerActions(source, file))
      serverActions.push({ file, ...action });
    for (const rpc of rpcCallSites(source)) rpcCalls.push({ file, ...rpc });
    for (const finding of serviceRoleReferences(source, file)) {
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
    schemaVersion: 2,
    provenance: {
      repositoryRoot: root,
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      gitDirty:
        execFileSync(
          "git",
          ["status", "--porcelain=v1", "--untracked-files=all"],
          { cwd: root, encoding: "utf8" },
        ).length > 0,
      inventoryInputSha256: inventoryInputHash.digest("hex"),
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
  return `# Repository audit surface inventory\n\n- Evidence class: ${inventory.provenance.evidenceClass}\n- Environment: ${inventory.provenance.environment}\n- Root commit: ${inventory.provenance.gitCommit}\n- Root tree dirty: ${inventory.provenance.gitDirty}\n- Inventory input SHA-256: ${inventory.provenance.inventoryInputSha256}\n- Private plugin commit: ${inventory.provenance.privatePluginCommit}\n\n| Surface | Count |\n| --- | ---: |\n${rows}\n\nThis is a static source inventory, not proof that a route is reachable or that a database grant is effective. Runtime catalog and hosted Development verification are separate gates.\n`;
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
