import { parseCertificateCsv } from "./csv-verification-logic";
import type { CertificateRow } from "./csv-verification-types";

export async function parseCertificateFiles(
  files: readonly File[],
): Promise<CertificateRow[]> {
  if (!files.length || files.length > 20)
    throw new Error("Choose between 1 and 20 CSV files.");
  if (files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024)
    throw new Error("Choose CSV files totaling at most 10 MB.");
  const contents = new Set<string>();
  const rows: CertificateRow[] = [];
  for (const file of files) {
    if (!/\.csv$/i.test(file.name))
      throw new Error(`${file.name}: choose a CSV file.`);
    const text = (await file.text())
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (contents.has(text))
      throw new Error(
        `${file.name}: this CSV is already included, even if its filename is different.`,
      );
    contents.add(text);
    const parsed = parseCertificateCsv(text);
    if (!("rows" in parsed)) throw new Error(`${file.name}: ${parsed.error}`);
    rows.push(...parsed.rows);
    if (rows.length > 2000)
      throw new Error("Verify at most 2,000 certificate rows at a time.");
  }
  return rows;
}
