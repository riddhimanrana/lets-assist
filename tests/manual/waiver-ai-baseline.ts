import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractPdfTextWithPositions } from '@/lib/waiver/pdf-text-extract';
import { findLabels } from '@/lib/waiver/label-detection';
import { detectCandidateAreas } from '@/lib/waiver/candidate-detection';

const inputArg = process.argv[2] || 'Volunteer Waiver 2025.pdf';
const filePath = path.isAbsolute(inputArg) ? inputArg : path.resolve(process.cwd(), inputArg);

async function main() {
  const pdf = readFileSync(filePath);
  const extraction = await extractPdfTextWithPositions(new Uint8Array(pdf));

  const textItems = extraction.success ? extraction.textItems : [];
  const labels = findLabels(textItems);
  const candidates = detectCandidateAreas(textItems, labels);

  const summary = {
    filePath,
    extractionSuccess: extraction.success,
    pageCount: extraction.pageCount,
    textItems: textItems.length,
    labels: labels.length,
    labelTypes: labels.reduce<Record<string, number>>((acc, l) => {
      acc[l.type] = (acc[l.type] ?? 0) + 1;
      return acc;
    }, {}),
    candidates: candidates.length,
    candidateSources: candidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.source] = (acc[c.source] ?? 0) + 1;
      return acc;
    }, {}),
    maxCandidateWidth: candidates.reduce((max, c) => Math.max(max, c.rect.width), 0),
    maxCandidateHeight: candidates.reduce((max, c) => Math.max(max, c.rect.height), 0),
    labelsPreview: labels.slice(0, 20).map((l) => ({
      type: l.type,
      text: l.text,
      rect: l.rect,
      confidence: l.confidence,
    })),
    candidatesPreview: candidates.slice(0, 25).map((c) => ({
      id: c.id,
      source: c.source,
      typeHint: c.typeHint,
      score: c.score,
      pageIndex: c.pageIndex,
      rect: c.rect,
      nearbyLabelTypes: c.nearbyLabelTypes,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('waiver-ai-baseline failed:', error);
  process.exit(1);
});
