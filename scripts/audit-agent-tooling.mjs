#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PIN = /@[0-9a-f]{40}(?:\s|$)/u;

export function collectAgentToolingIssues({
  agentGuide,
  claudeGuide,
  copilotGuide,
  mcpConfig,
  packageJson,
  rootFiles,
  workflows,
  localMcpConfigs = [],
  localConfigSources = [],
}) {
  const issues = [];
  if (!claudeGuide.includes("AGENTS.md"))
    issues.push("CLAUDE.md must point to AGENTS.md.");
  if (!copilotGuide.includes("AGENTS.md"))
    issues.push("Copilot instructions must point to AGENTS.md.");
  if (
    !agentGuide.includes("generic skills") ||
    !agentGuide.includes("tool defaults")
  )
    issues.push(
      "AGENTS.md must state repository precedence over generic tooling.",
    );
  if (!packageJson.packageManager?.startsWith("bun@"))
    issues.push("package.json must pin Bun as the package manager.");
  for (const lockfile of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    if (rootFiles.includes(lockfile))
      issues.push(`Root ${lockfile} conflicts with the Bun-only toolchain.`);
  }

  const inspectMcpConfig = (config, label) => {
    const endpoints = new Set();
    const servers = config.mcpServers ?? config.servers ?? {};
    for (const [name, server] of Object.entries(servers)) {
      if (/resend/iu.test(name))
        issues.push(`${label} enables direct Resend tooling: ${name}`);
      if (server.type !== "http" || typeof server.url !== "string") continue;
      const url = new URL(server.url);
      const endpoint = url.toString();
      if (endpoints.has(endpoint))
        issues.push(`Duplicate MCP endpoint in ${label}: ${endpoint}`);
      endpoints.add(endpoint);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
        continue;
      if (url.protocol !== "https:")
        issues.push(`Remote MCP ${name} must use HTTPS.`);
      if (url.searchParams.get("read_only") !== "true")
        issues.push(`Remote MCP ${name} must be read-only.`);
      if (!name.includes("production-readonly"))
        issues.push(
          `Remote MCP ${name} must identify Production and read-only scope.`,
        );
    }
  };
  inspectMcpConfig(mcpConfig, ".mcp.json");
  for (const [label, config] of localMcpConfigs)
    inspectMcpConfig(config, label);

  for (const [label, source] of localConfigSources) {
    if (source.includes("/private/tmp/") || source.includes("csf-worktrees/"))
      issues.push(`${label} contains a stale temporary-worktree path.`);
  }

  for (const [workflowPath, source] of workflows) {
    for (const line of source.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!/^-?\s*uses:/u.test(trimmed) || trimmed.includes("./.github/"))
        continue;
      if (!SHA_PIN.test(trimmed))
        issues.push(`${workflowPath} contains an unpinned action: ${trimmed}`);
    }
    if (source.includes("x-vercel-protection-bypass="))
      issues.push(`${workflowPath} puts the Vercel bypass secret in a URL.`);
    if (/head\s+-c\s+4000/u.test(source))
      issues.push(`${workflowPath} prints response bodies to the Actions log.`);
  }
  return issues;
}

export function auditRepository(root) {
  const read = (relativePath) =>
    readFileSync(path.join(root, relativePath), "utf8");
  const workflowRoot = path.join(root, ".github/workflows");
  const workflows = readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => [
      `.github/workflows/${name}`,
      read(`.github/workflows/${name}`),
    ]);
  const localMcpConfigs = [".vscode/mcp.json"]
    .filter((relativePath) => existsSync(path.join(root, relativePath)))
    .map((relativePath) => [relativePath, JSON.parse(read(relativePath))]);
  const localConfigSources = [
    ".claude/launch.json",
    ".claude/settings.local.json",
  ]
    .filter((relativePath) => existsSync(path.join(root, relativePath)))
    .map((relativePath) => [relativePath, read(relativePath)]);
  return collectAgentToolingIssues({
    agentGuide: read("AGENTS.md"),
    claudeGuide: read("CLAUDE.md"),
    copilotGuide: read(".github/copilot-instructions.md"),
    mcpConfig: JSON.parse(read(".mcp.json")),
    packageJson: JSON.parse(read("package.json")),
    rootFiles: readdirSync(root),
    workflows,
    localMcpConfigs,
    localConfigSources,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const issues = auditRepository(process.cwd());
  if (issues.length) {
    for (const issue of issues) console.error(`[agent-tooling] ${issue}`);
    process.exit(1);
  }
  console.log(
    "Agent, MCP, package-manager, and workflow configuration passed.",
  );
}
