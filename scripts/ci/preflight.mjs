#!/usr/bin/env bun
// Runs the pull request gate on a developer machine.
//
// The step list comes from .github/workflows/ci.yml itself (see
// workflow-plan.mjs). Steps that only make sense on a runner are named and
// skipped. Commands shared by several jobs run once, first. After that each job
// is a lane: lanes run side by side as they do in CI, and the steps inside a
// lane run in workflow order. Shards of one job share this working tree, so
// they run one after another rather than at the same time.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pullRequestPlan, scheduleSteps } from "./workflow-plan.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workflowPath = join(repositoryRoot, ".github/workflows/ci.yml");
const logDirectory = join(repositoryRoot, ".artifacts/ci-preflight");
const FAILURE_TAIL_LINES = 40;

export function preflightArguments(args) {
  const options = { base: null, serial: false, list: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--serial") options.serial = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--base") {
      options.base = args[index + 1] ?? "";
      index += 1;
    } else if (argument.startsWith("--base=")) {
      options.base = argument.slice("--base=".length);
    } else {
      throw new Error(
        `Unknown argument: ${argument}\nUsage: bun run ci:preflight [--base <sha>] [--serial] [--list]`,
      );
    }
  }
  return options;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// The affected-test step needs an exact commit. A ref or short SHA given on
// the command line is resolved here; nothing is fetched.
export function resolveBase(requested, run = git) {
  let sha;
  if (requested === null) {
    try {
      sha = run(["merge-base", "HEAD", "origin/development"]);
    } catch {
      throw new Error(
        "No merge base with origin/development. Fetch it, or pass --base <sha>.",
      );
    }
  } else {
    if (!/^[\w./-]+$/u.test(requested) || requested.startsWith("-"))
      throw new Error(`Invalid --base value: ${requested}`);
    try {
      sha = run(["rev-parse", "--verify", `${requested}^{commit}`]);
    } catch {
      throw new Error(`--base does not name a commit here: ${requested}`);
    }
  }
  if (!/^[0-9a-f]{40}$/u.test(sha))
    throw new Error(`Could not resolve the base commit: ${sha}`);
  return sha;
}

function seconds(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`.padStart(7);
}

function logName(step, index) {
  const slug = `${step.job}-${step.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return `${String(index).padStart(2, "0")}-${slug}.log`;
}

function runStep(step, index) {
  return new Promise((resolveStep) => {
    const started = Date.now();
    const chunks = [];
    // The same shell contract as a workflow `run:` step.
    const child = spawn("bash", ["-e", "-c", step.run], {
      cwd: repositoryRoot,
      env: { ...process.env, ...step.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const finish = (status, note = "") => {
      const output = `${Buffer.concat(chunks).toString("utf8")}${note}`;
      const logPath = join(logDirectory, logName(step, index));
      writeFileSync(logPath, output);
      resolveStep({
        step,
        passed: status === 0,
        status,
        duration: Date.now() - started,
        output,
        logPath,
      });
    };
    child.on("error", (error) => finish(1, `\n${error.message}\n`));
    child.on("close", (status, signal) =>
      finish(status ?? 1, signal ? `\nTerminated by ${signal}.\n` : ""),
    );
  });
}

function report(result) {
  const { step, passed, duration, output, logPath } = result;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${seconds(duration)}  ${step.job} > ${step.name}`,
  );
  if (passed) return;
  const lines = output.trimEnd().split("\n");
  console.log(
    `     last ${Math.min(lines.length, FAILURE_TAIL_LINES)} lines (full log: ${logPath}):`,
  );
  for (const line of lines.slice(-FAILURE_TAIL_LINES))
    console.log(`     | ${line}`);
}

async function runLane(steps, results, nextIndex) {
  for (const step of steps) {
    const result = await runStep(step, nextIndex());
    results.push(result);
    report(result);
  }
}

async function main() {
  const options = preflightArguments(process.argv.slice(2));
  const baseSha = resolveBase(options.base);
  const plan = pullRequestPlan(readFileSync(workflowPath, "utf8"), { baseSha });
  const { setup, lanes } = scheduleSteps(plan.steps);

  console.log(
    `[preflight] base ${baseSha}${options.base === null ? " (merge base with origin/development)" : ""}`,
  );
  console.log(
    `[preflight] pull request jobs: ${[...new Set(plan.jobs.map((job) => job.label))].join(", ")}`,
  );
  const skipped = new Map();
  for (const { name, reason } of plan.skipped) {
    const key = `${name}: ${reason}`;
    skipped.set(key, (skipped.get(key) ?? 0) + 1);
  }
  console.log("[preflight] skipped here because they need a runner:");
  for (const [key, count] of skipped)
    console.log(`  - ${key}${count > 1 ? ` (in ${count} jobs)` : ""}`);

  const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  if (dirty.length > 0) {
    console.log(
      `[preflight] note: ${dirty.length} uncommitted paths. Checks read the working tree, but the affected-test step selects its scope from committed changes (base..HEAD), exactly as the gate does.`,
    );
  }

  if (options.list) {
    console.log("[preflight] setup, run once:");
    for (const step of setup) console.log(`  - ${step.name}: ${step.run}`);
    for (const lane of lanes) {
      console.log(
        `[preflight] lane ${[...new Set(lane.map((step) => step.job))].join(", ")}:`,
      );
      for (const step of lane)
        console.log(
          `  - ${step.name}: ${step.run.trim().split("\n").join(" && ")}`,
        );
    }
    return 0;
  }

  mkdirSync(logDirectory, { recursive: true });
  const started = Date.now();
  const results = [];
  let index = 0;
  const nextIndex = () => (index += 1);

  await runLane(setup, results, nextIndex);
  if (results.some((result) => !result.passed)) {
    const remaining = lanes.flat().length;
    console.log(
      `[preflight] setup failed; ${remaining} later steps were not run.`,
    );
    return 1;
  }

  if (options.serial) {
    for (const lane of lanes) await runLane(lane, results, nextIndex);
  } else {
    await Promise.all(lanes.map((lane) => runLane(lane, results, nextIndex)));
  }

  const failed = results.filter((result) => !result.passed);
  console.log(
    `[preflight] ${results.length - failed.length} passed, ${failed.length} failed in ${seconds(Date.now() - started).trim()}.`,
  );
  for (const { step } of failed)
    console.log(`[preflight] failed: ${step.job} > ${step.name}`);
  return failed.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`[preflight] ${error.message}`);
    process.exit(1);
  }
}
