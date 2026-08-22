import { dirname, isAbsolute, relative, resolve } from "node:path";

const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/gu,
  /(?:^|\n)\s*import\s+["']([^"']+)["']\s*;?/gu,
  /\bimport\(\s*["']([^"']+)["']\s*(?:,\s*[^)]*)?\)/gu,
  /\bimport\(\s*`([^`${}]+)`\s*(?:,\s*[^)]*)?\)/gu,
  /\brequire\(\s*["']([^"']+)["']\s*\)/gu,
  /\brequire\(\s*`([^`${}]+)`\s*\)/gu,
];

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

  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) literals.add(match[1]);
  }

  return literals;
}
