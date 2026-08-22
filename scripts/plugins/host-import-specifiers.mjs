import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

function literalModuleSpecifier(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
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
            node.expression.name.text === "resolveWeak")) ||
          (ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "module" &&
            node.expression.name.text === "require"));
      if (isDynamicImport || isRequire || isRequireProperty) {
        const specifier = literalModuleSpecifier(node.arguments[0]);
        if (specifier !== null) literals.add(specifier);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return literals;
}
