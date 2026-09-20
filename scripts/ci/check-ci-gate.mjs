#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";

export function evaluateCiGate({
  changesResult,
  fullValidation,
  qualityResult,
  databaseResult,
}) {
  if (changesResult !== "success")
    return `Change classification finished with ${changesResult || "no result"}.`;
  if (fullValidation !== "true" && fullValidation !== "false")
    return "Change classification returned an invalid value.";
  if (qualityResult !== "success")
    return `Quality validation finished with ${qualityResult || "no result"}.`;
  if (fullValidation === "true" && databaseResult !== "success")
    return `Database and browser validation finished with ${databaseResult || "no result"}.`;
  if (fullValidation === "false" && databaseResult !== "skipped")
    return `Documentation-only validation expected the database job to be skipped, not ${databaseResult || "no result"}.`;
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const issue = evaluateCiGate({
    changesResult: process.env.CHANGES_RESULT,
    fullValidation: process.env.FULL_VALIDATION,
    qualityResult: process.env.QUALITY_RESULT,
    databaseResult: process.env.DATABASE_RESULT,
  });
  if (issue) {
    console.error(issue);
    process.exit(1);
  }
  console.log("All required validation jobs passed.");
}
