import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = process.env.WAIVER_AI_BASE_URL || 'http://127.0.0.1:3000';
const SAMPLE_PDF_PATH = process.env.WAIVER_SAMPLE_PDF || path.resolve(process.cwd(), 'Sample Volunteer Waiver.pdf');
const RUNS = Number.parseInt(process.env.WAIVER_BENCHMARK_RUNS || '10', 10);
const MAX_ATTEMPTS_MULTIPLIER = Number.parseInt(process.env.WAIVER_MAX_ATTEMPTS_MULTIPLIER || '3', 10);
const STRICT_GUARD = (process.env.WAIVER_STRICT_GUARD || 'true').toLowerCase() !== 'false';
const MODELS = (process.env.WAIVER_MODELS || 'google/gemini-3-flash,google/gemini-2.5-flash-lite')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fieldKey(field) {
  const box = field.boundingBox || {};
  return [
    field.fieldType || 'unknown',
    field.signerRole || 'unknown',
    safeNumber(field.pageIndex, 0),
    Math.round(safeNumber(box.x, 0) / 10),
    Math.round(safeNumber(box.y, 0) / 10),
    Math.round(safeNumber(box.width, 0) / 10),
    Math.round(safeNumber(box.height, 0) / 10),
  ].join(':');
}

function getIou(a, b) {
  const ax = safeNumber(a?.x, 0);
  const ay = safeNumber(a?.y, 0);
  const aw = safeNumber(a?.width, 0);
  const ah = safeNumber(a?.height, 0);

  const bx = safeNumber(b?.x, 0);
  const by = safeNumber(b?.y, 0);
  const bw = safeNumber(b?.width, 0);
  const bh = safeNumber(b?.height, 0);

  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;

  const areaA = Math.max(0, aw) * Math.max(0, ah);
  const areaB = Math.max(0, bw) * Math.max(0, bh);
  const union = areaA + areaB - interArea;
  return union > 0 ? interArea / union : 0;
}

function runConsistencyAgainstBaseline(baselineFields, runFields) {
  if (!Array.isArray(baselineFields) || baselineFields.length === 0) return 1;
  if (!Array.isArray(runFields) || runFields.length === 0) return 0;

  const used = new Set();
  let matched = 0;

  for (const baseField of baselineFields) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < runFields.length; i += 1) {
      if (used.has(i)) continue;
      const candidate = runFields[i];
      if ((candidate.fieldType || '') !== (baseField.fieldType || '')) continue;
      if (safeNumber(candidate.pageIndex, -1) !== safeNumber(baseField.pageIndex, -2)) continue;

      const iou = getIou(baseField.boundingBox, candidate.boundingBox);
      if (iou > bestScore) {
        bestScore = iou;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore >= 0.5) {
      used.add(bestIndex);
      matched += 1;
    }
  }

  return matched / baselineFields.length;
}

async function runSingleScan({ model, pdfBytes, runIndex }) {
  const formData = new FormData();
  formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), path.basename(SAMPLE_PDF_PATH));
  formData.append('includeDiagnostics', 'true');
  formData.append('strictHallucinationGuard', STRICT_GUARD ? 'true' : 'false');
  formData.append('model', model);

  let response;
  try {
    response = await fetch(`${BASE_URL}/api/ai/analyze-waiver`, {
      method: 'POST',
      body: formData,
    });
  } catch (error) {
    return {
      ok: false,
      runIndex,
      error: error instanceof Error ? error.message : 'network error',
      status: 0,
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.analysis) {
    const errorMessage = payload?.error || payload?.details || `HTTP ${response.status}`;
    return {
      ok: false,
      runIndex,
      error: errorMessage,
      status: response.status,
    };
  }

  const analysis = payload.analysis;
  const fields = Array.isArray(analysis.fields) ? analysis.fields : [];
  const diagnostics = analysis.diagnostics || {};

  const suspiciousCount = fields.filter((field) =>
    String(field?.notes || '').toLowerCase().includes('unanchored vision fallback')
  ).length;

  const snappedCount = fields.filter((field) =>
    String(field?.notes || '').toLowerCase().includes('snapped to structural candidate')
  ).length;

  const uniqueRoleCount = Array.isArray(analysis.signerRoles) ? analysis.signerRoles.length : 0;

  return {
    ok: true,
    runIndex,
    fields,
    summary: {
      pageCount: safeNumber(analysis.pageCount, 0),
      fieldCount: fields.length,
      uniqueRoleCount,
      suspiciousCount,
      snappedCount,
      diagnostics,
      fingerprint: new Set(fields.map(fieldKey)).size,
    },
  };
}

function summarizeModelResults(model, runs) {
  const successes = runs.filter((run) => run.ok);
  const failures = runs.filter((run) => !run.ok);

  const summary = {
    model,
    attemptedRuns: runs.length,
    successfulRuns: successes.length,
    failedRuns: failures.length,
    meanFieldCount: 0,
    minFieldCount: 0,
    maxFieldCount: 0,
    meanSuspiciousCount: 0,
    meanSnappedCount: 0,
    meanRoles: 0,
    meanConsistencyAgainstRun1: 0,
    meanVisionRejected: 0,
    meanVisionAnchoredDiagnostics: 0,
    dominantFingerprintCount: 0,
    failures,
  };

  if (successes.length === 0) {
    return summary;
  }

  const fieldCounts = successes.map((run) => safeNumber(run.summary.fieldCount, 0));
  const suspiciousCounts = successes.map((run) => safeNumber(run.summary.suspiciousCount, 0));
  const snappedCounts = successes.map((run) => safeNumber(run.summary.snappedCount, 0));
  const roleCounts = successes.map((run) => safeNumber(run.summary.uniqueRoleCount, 0));
  const rejectedCounts = successes.map((run) => safeNumber(run.summary.diagnostics?.visionFieldsRejected, 0));
  const anchoredDiagCounts = successes.map((run) => safeNumber(run.summary.diagnostics?.visionFieldsAnchored, 0));

  const baseline = successes[0].fields;
  const consistency = successes.map((run) => runConsistencyAgainstBaseline(baseline, run.fields));

  const fingerprintFrequency = new Map();
  for (const run of successes) {
    const key = String(run.summary.fingerprint);
    fingerprintFrequency.set(key, (fingerprintFrequency.get(key) || 0) + 1);
  }

  summary.meanFieldCount = fieldCounts.reduce((sum, v) => sum + v, 0) / fieldCounts.length;
  summary.minFieldCount = Math.min(...fieldCounts);
  summary.maxFieldCount = Math.max(...fieldCounts);
  summary.meanSuspiciousCount = suspiciousCounts.reduce((sum, v) => sum + v, 0) / suspiciousCounts.length;
  summary.meanSnappedCount = snappedCounts.reduce((sum, v) => sum + v, 0) / snappedCounts.length;
  summary.meanRoles = roleCounts.reduce((sum, v) => sum + v, 0) / roleCounts.length;
  summary.meanConsistencyAgainstRun1 = consistency.reduce((sum, v) => sum + v, 0) / consistency.length;
  summary.meanVisionRejected = rejectedCounts.reduce((sum, v) => sum + v, 0) / rejectedCounts.length;
  summary.meanVisionAnchoredDiagnostics = anchoredDiagCounts.reduce((sum, v) => sum + v, 0) / anchoredDiagCounts.length;
  summary.dominantFingerprintCount = Math.max(...fingerprintFrequency.values());

  return summary;
}

function printModelSummary(summary) {
  console.log(`\n=== ${summary.model} ===`);
  console.log(`runs: ${summary.successfulRuns}/${summary.attemptedRuns} successful`);
  console.log(`field count: mean=${summary.meanFieldCount.toFixed(2)} min=${summary.minFieldCount} max=${summary.maxFieldCount}`);
  console.log(`roles mean: ${summary.meanRoles.toFixed(2)}`);
  console.log(`consistency vs run1: ${(summary.meanConsistencyAgainstRun1 * 100).toFixed(1)}%`);
  console.log(`snapped placements mean: ${summary.meanSnappedCount.toFixed(2)}`);
  console.log(`suspicious placements mean: ${summary.meanSuspiciousCount.toFixed(2)}`);
  console.log(`vision rejected mean (diag): ${summary.meanVisionRejected.toFixed(2)}`);
  console.log(`vision anchored mean (diag): ${summary.meanVisionAnchoredDiagnostics.toFixed(2)}`);
  console.log(`dominant fingerprint frequency: ${summary.dominantFingerprintCount}/${summary.successfulRuns}`);

  if (summary.failedRuns > 0) {
    console.log('failures:');
    for (const fail of summary.failures) {
      console.log(`  run ${fail.runIndex}: ${fail.error}`);
    }
  }
}

function printHeadToHead(primary, secondary) {
  console.log('\n=== HEAD-TO-HEAD (higher is better unless noted) ===');
  console.log(`${primary.model} consistency: ${(primary.meanConsistencyAgainstRun1 * 100).toFixed(1)}%`);
  console.log(`${secondary.model} consistency: ${(secondary.meanConsistencyAgainstRun1 * 100).toFixed(1)}%`);
  console.log(`${primary.model} suspicious mean (lower better): ${primary.meanSuspiciousCount.toFixed(2)}`);
  console.log(`${secondary.model} suspicious mean (lower better): ${secondary.meanSuspiciousCount.toFixed(2)}`);
}

async function main() {
  console.log('Waiver AI 10-scan benchmark');
  console.log(`baseUrl: ${BASE_URL}`);
  console.log(`sample: ${SAMPLE_PDF_PATH}`);
  console.log(`runs/model: ${RUNS}`);
  console.log(`max attempts multiplier: ${MAX_ATTEMPTS_MULTIPLIER}`);
  console.log(`strictGuard: ${STRICT_GUARD}`);
  console.log(`models: ${MODELS.join(', ')}`);

  const pdfBytes = await fs.readFile(SAMPLE_PDF_PATH);

  const summaries = [];

  for (const model of MODELS) {
    const modelRuns = [];
    const maxAttempts = Math.max(RUNS, RUNS * Math.max(MAX_ATTEMPTS_MULTIPLIER, 1));
    let attempt = 0;
    let successful = 0;

    while (successful < RUNS && attempt < maxAttempts) {
      attempt += 1;
      process.stdout.write(`\r[${model}] success ${successful}/${RUNS} (attempt ${attempt}/${maxAttempts}) ...`);
      const result = await runSingleScan({ model, pdfBytes, runIndex: attempt });
      modelRuns.push(result);

      if (result.ok) {
        successful += 1;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    process.stdout.write('\n');

    const summary = summarizeModelResults(model, modelRuns);
    summaries.push(summary);
    printModelSummary(summary);
  }

  if (summaries.length >= 2) {
    printHeadToHead(summaries[0], summaries[1]);
  }

  console.log('\nBenchmark complete.');
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exitCode = 1;
});
