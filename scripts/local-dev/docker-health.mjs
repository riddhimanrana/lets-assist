#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const PROJECT_LABEL = "com.supabase.cli.project";
const LETS_ASSIST_PREFIXES = [
  "lets-assist",
  "lets-assist-csf-browser-",
  "lets-assist-csf-replay-",
];

function runDocker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`Docker is unavailable: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `docker ${args[0]} failed`);
  }
  return result.stdout.trim();
}

export function parseContainerRows(source) {
  return source
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [project, state, status, name] = line.split("|");
      return { project, state, status, name };
    })
    .filter(({ project }) =>
      LETS_ASSIST_PREFIXES.some(
        (prefix) => project === prefix || project.startsWith(prefix),
      ),
    );
}

export function summarizeProjects(rows) {
  const projects = new Map();
  for (const row of rows) {
    const summary = projects.get(row.project) ?? {
      project: row.project,
      containers: 0,
      running: 0,
      restarting: 0,
      unhealthy: 0,
    };
    summary.containers += 1;
    if (row.state === "running") summary.running += 1;
    if (row.state === "restarting") summary.restarting += 1;
    if (row.status.includes("unhealthy")) summary.unhealthy += 1;
    projects.set(row.project, summary);
  }
  return [...projects.values()].sort((left, right) =>
    left.project.localeCompare(right.project),
  );
}

export function healthVerdict(projects) {
  const restartLoops = projects.filter(
    ({ restarting, unhealthy }) => restarting > 0 || unhealthy > 0,
  );
  const overloaded = projects.length > 2;
  return {
    healthy: restartLoops.length === 0 && !overloaded,
    overloaded,
    restartLoops,
  };
}

function main() {
  const info = runDocker([
    "info",
    "--format",
    "cpus={{.NCPU}} memory={{.MemTotal}} containers={{.Containers}} running={{.ContainersRunning}} images={{.Images}}",
  ]);
  const rows = parseContainerRows(
    runDocker([
      "ps",
      "-a",
      "--filter",
      `label=${PROJECT_LABEL}`,
      "--format",
      `{{.Label "${PROJECT_LABEL}"}}|{{.State}}|{{.Status}}|{{.Names}}`,
    ]),
  );
  const projects = summarizeProjects(rows);
  const verdict = healthVerdict(projects);

  console.log(`Docker: ${info}`);
  if (projects.length === 0) {
    console.log("Let's Assist Supabase stacks: none");
    return;
  }

  console.log(`Let's Assist Supabase stacks: ${projects.length}`);
  for (const project of projects) {
    console.log(
      `  ${project.project}: ${project.running}/${project.containers} running, ${project.restarting} restarting, ${project.unhealthy} unhealthy`,
    );
  }

  if (verdict.overloaded) {
    console.error(
      "Too many Let's Assist Supabase stacks are present. Keep one development stack and one active test stack at most.",
    );
  }
  for (const project of verdict.restartLoops) {
    console.error(
      `Restarting or unhealthy containers detected in ${project.project}.`,
    );
  }
  if (!verdict.healthy) {
    console.error(
      "Use the marker-bounded stop command printed by the stack launcher. Do not use docker system prune or supabase stop --all.",
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
