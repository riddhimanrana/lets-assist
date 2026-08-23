import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

function literalModuleSpecifier(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function isImportMetaProperty(node, propertyName) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === "meta" &&
    node.name.text === propertyName
  );
}

function isOutside(root, candidate) {
  const path = relative(root, candidate);
  return (
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(path)
  );
}

function normalizeRelativeHostSpecifier(specifier, context) {
  const target = resolve(dirname(context.sourceFile), specifier);
  if (!isOutside(context.privateRoot, target)) return null;
  if (isOutside(context.repositoryRoot, target)) {
    return `outside-repository:${specifier}`;
  }
  return `@/${relative(context.repositoryRoot, target).replaceAll("\\", "/")}`;
}

export function collectHostImportSpecifiers(source, context) {
  const literals = collectLiteralImportSpecifiers(source);

  const hostSpecifiers = new Set();
  for (const specifier of literals) {
    if (specifier.startsWith("@/")) {
      hostSpecifiers.add(specifier);
    } else if (context && specifier.startsWith(".")) {
      const normalized = normalizeRelativeHostSpecifier(specifier, context);
      if (normalized) hostSpecifiers.add(normalized);
    }
  }

  return hostSpecifiers;
}

export function collectLiteralImportSpecifiers(source) {
  return collectLiteralDependencySpecifiers(source, {
    includeUrlDependencies: false,
  });
}

export function collectLiteralApplicationDependencySpecifiers(source) {
  return collectLiteralDependencySpecifiers(source, {
    includeUrlDependencies: true,
  });
}

export function collectStylesheetDependencySpecifiers(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, "");
  const specifiers = new Set();
  const statementPattern = /@(import|use|forward)\s+([^;\r\n]+)(?:;|$)/gimu;

  for (const statement of withoutComments.matchAll(statementPattern)) {
    const parameters = statement[2] ?? "";
    const quotedPattern = /["']([^"']+)["']/gu;
    for (const quoted of parameters.matchAll(quotedPattern)) {
      if (quoted[1]) specifiers.add(quoted[1]);
    }

    const bareUrlPattern = /url\(\s*([^\s"')]+)\s*\)/giu;
    for (const bareUrl of parameters.matchAll(bareUrlPattern)) {
      if (bareUrl[1]) specifiers.add(bareUrl[1]);
    }
  }

  return specifiers;
}

function collectLiteralDependencySpecifiers(
  source,
  { includeUrlDependencies },
) {
  const literals = new Set();
  const sourceFile = ts.createSourceFile(
    "plugin-source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const specifier = literalModuleSpecifier(node.moduleSpecifier);
      if (specifier !== null) literals.add(specifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      const specifier = literalModuleSpecifier(node.moduleReference.expression);
      if (specifier !== null) literals.add(specifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      const specifier = literalModuleSpecifier(node.argument.literal);
      if (specifier !== null) literals.add(specifier);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isRequireProperty =
        ts.isPropertyAccessExpression(node.expression) &&
        ((ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "require" &&
          (node.expression.name.text === "resolve" ||
            node.expression.name.text === "resolveWeak" ||
            node.expression.name.text === "context")) ||
          (ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "module" &&
            node.expression.name.text === "require"));
      const isImportMetaResolve = isImportMetaProperty(
        node.expression,
        "resolve",
      );
      if (
        isDynamicImport ||
        isRequire ||
        isRequireProperty ||
        isImportMetaResolve
      ) {
        const specifier = literalModuleSpecifier(node.arguments[0]);
        if (specifier !== null) literals.add(specifier);
      }
    } else if (
      includeUrlDependencies &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.length === 2 &&
      isImportMetaProperty(node.arguments[1], "url")
    ) {
      const specifier = literalModuleSpecifier(node.arguments[0]);
      if (specifier !== null) literals.add(specifier);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return literals;
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
}

export function readApplicationCompilerOptions(applicationDirectory) {
  const configPath = ts.findConfigFile(
    applicationDirectory,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) return {};

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(formatDiagnostics([config.error]));
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(formatDiagnostics(parsed.errors));
  }
  return parsed.options;
}

export function resolveApplicationImportSpecifier(
  specifier,
  sourceFile,
  compilerOptions,
) {
  const resolution = ts.resolveModuleName(
    specifier,
    sourceFile,
    compilerOptions,
    ts.sys,
  );
  return resolution.resolvedModule
    ? resolve(resolution.resolvedModule.resolvedFileName)
    : null;
}

export function resolveEscapingApplicationImportSpecifier(
  specifier,
  sourceFile,
  applicationRoot,
  compilerOptions,
) {
  const target = specifier.startsWith(".")
    ? resolve(dirname(sourceFile), specifier)
    : resolveApplicationImportSpecifier(specifier, sourceFile, compilerOptions);
  if (!target || target.split(/[\\/]/u).includes("node_modules")) return null;
  return isOutside(applicationRoot, target) ? target : null;
}
