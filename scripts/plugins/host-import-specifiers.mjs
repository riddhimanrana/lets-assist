const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["'](@\/[^"']+)["']/gu,
  /(?:^|\n)\s*import\s+["'](@\/[^"']+)["']\s*;?/gu,
  /\bimport\(\s*["'](@\/[^"']+)["']\s*\)/gu,
  /\brequire\(\s*["'](@\/[^"']+)["']\s*\)/gu,
];

export function collectHostImportSpecifiers(source) {
  const specifiers = new Set();

  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }

  return specifiers;
}
