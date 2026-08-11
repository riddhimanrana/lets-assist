const FORMULA_LEADING_TEXT = /^[\t\r ]*[=+\-@]/u;

export function neutralizeSpreadsheetFormula(value: string): string {
  return FORMULA_LEADING_TEXT.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";

  const safeValue = neutralizeSpreadsheetFormula(String(value));
  if (
    safeValue.includes(",") ||
    safeValue.includes("\n") ||
    safeValue.includes("\r") ||
    safeValue.includes('"')
  ) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }

  return safeValue;
}
