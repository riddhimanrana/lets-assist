import { dirname, isAbsolute, relative, resolve } from "node:path";

const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/gu,
  /(?:^|\n)\s*import\s+["']([^"']+)["']\s*;?/gu,
  /\brequire\(\s*["']([^"']+)["']\s*\)/gu,
  /\brequire\(\s*`([^`${}]+)`\s*\)/gu,
];

function isIdentifierCharacter(character) {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
}

function skipDynamicImportTrivia(source, start) {
  let cursor = start;

  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) {
      cursor += 1;
      continue;
    }

    if (source.startsWith("//", cursor)) {
      const newline = source.indexOf("\n", cursor + 2);
      if (newline === -1) return source.length;
      cursor = newline + 1;
      continue;
    }

    if (source.startsWith("/*", cursor)) {
      const commentEnd = source.indexOf("*/", cursor + 2);
      if (commentEnd === -1) return source.length;
      cursor = commentEnd + 2;
      continue;
    }

    break;
  }

  return cursor;
}

function collectDynamicImportSpecifiers(source) {
  const specifiers = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const importStart = source.indexOf("import", searchFrom);
    if (importStart === -1) break;
    searchFrom = importStart + "import".length;

    if (
      isIdentifierCharacter(source[importStart - 1]) ||
      isIdentifierCharacter(source[searchFrom])
    ) {
      continue;
    }

    let cursor = searchFrom;
    while (/\s/u.test(source[cursor])) cursor += 1;
    if (source[cursor] !== "(") continue;

    cursor = skipDynamicImportTrivia(source, cursor + 1);
    const delimiter = source[cursor];
    if (delimiter !== '"' && delimiter !== "'" && delimiter !== "`") continue;

    let value = "";
    let interpolated = false;
    for (cursor += 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === "\\") {
        if (cursor + 1 >= source.length) break;
        value += character + source[cursor + 1];
        cursor += 1;
        continue;
      }
      if (delimiter === "`" && character === "$" && source[cursor + 1] === "{") {
        interpolated = true;
      }
      if (character === delimiter) {
        if (!interpolated) specifiers.push(value);
        searchFrom = cursor + 1;
        break;
      }
      value += character;
    }
  }

  return specifiers;
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
  const literals = new Set(collectDynamicImportSpecifiers(source));

  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) literals.add(match[1]);
  }

  return literals;
}
