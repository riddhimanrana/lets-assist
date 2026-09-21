import { describe, expect, test } from "bun:test";

import { collectAgentToolingIssues } from "./audit-agent-tooling.mjs";

function validInput() {
  return {
    agentGuide: "Repository rules override generic skills and tool defaults.",
    claudeGuide: "Read AGENTS.md.",
    copilotGuide: "Read AGENTS.md.",
    cursorGuide: "Read AGENTS.md.",
    deliverySkill:
      "Keep one branch and pull request. Run the full `Code quality` workflow once.",
    mcpConfig: {
      mcpServers: {
        "supabase-local": {
          type: "http",
          url: "http://127.0.0.1:54321/mcp",
        },
        "supabase-production-readonly": {
          type: "http",
          url: "https://mcp.supabase.com/mcp?project_ref=example&read_only=true",
        },
      },
    },
    packageJson: { packageManager: "bun@1.3.14" },
    rootFiles: ["bun.lock", "package.json"],
    workflows: [
      [
        ".github/workflows/ci.yml",
        "steps:\n  - uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6",
      ],
    ],
  };
}

describe("agent tooling audit", () => {
  test("accepts the reviewed repository posture", () => {
    expect(collectAgentToolingIssues(validInput())).toEqual([]);
  });

  test("rejects writable remote MCPs, duplicate endpoints, and unpinned actions", () => {
    const input = validInput();
    input.mcpConfig.mcpServers = {
      production: { type: "http", url: "http://mcp.example.com/mcp" },
      duplicate: { type: "http", url: "http://mcp.example.com/mcp" },
    };
    input.workflows = [
      [".github/workflows/ci.yml", "steps:\n  - uses: actions/checkout@v6"],
    ];
    const issues = collectAgentToolingIssues(input);
    expect(
      issues.some((issue) => issue.includes("Duplicate MCP endpoint")),
    ).toBe(true);
    expect(issues.some((issue) => issue.includes("must be read-only"))).toBe(
      true,
    );
    expect(issues.some((issue) => issue.includes("unpinned action"))).toBe(
      true,
    );
  });

  test("rejects secret-bearing URLs and raw response logging", () => {
    const input = validInput();
    input.workflows = [
      [
        ".github/workflows/cron.yml",
        'run: curl "https://example.com/job?x-vercel-protection-bypass=${SECRET}"\n  head -c 4000 "$body_file"',
      ],
    ];
    const issues = collectAgentToolingIssues(input);
    expect(issues.some((issue) => issue.includes("bypass secret"))).toBe(true);
    expect(issues.some((issue) => issue.includes("response bodies"))).toBe(
      true,
    );
  });

  test("audits local MCP and launcher configuration when present", () => {
    const input = validInput();
    input.localMcpConfigs = [
      [
        ".vscode/mcp.json",
        {
          servers: {
            resend: { type: "stdio", command: "resend" },
            duplicate: {
              type: "http",
              url: "http://127.0.0.1:54321/mcp",
            },
            "duplicate-again": {
              type: "http",
              url: "http://127.0.0.1:54321/mcp",
            },
          },
        },
      ],
    ];
    input.localConfigSources = [
      [".claude/launch.json", '{"cwd":"/private/tmp/retired-worktree"}'],
    ];
    const issues = collectAgentToolingIssues(input);
    expect(issues.some((issue) => issue.includes("direct Resend"))).toBe(true);
    expect(
      issues.some((issue) => issue.includes("Duplicate MCP endpoint")),
    ).toBe(true);
    expect(issues.some((issue) => issue.includes("temporary-worktree"))).toBe(
      true,
    );
  });
});
