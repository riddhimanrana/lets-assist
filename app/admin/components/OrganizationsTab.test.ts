import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

for (const [timezone, createdAt] of [
  ["UTC", "2026-10-18T02:00:00Z"],
  ["America/Los_Angeles", "2026-10-18T02:00:00Z"],
  ["Asia/Tokyo", "2026-10-18T23:30:00Z"],
]) {
  test(`organization creation dates retain their UTC day when rendered in ${timezone}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        "--eval",
        `
        import { mock } from "bun:test";
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        mock.module("next/navigation", () => ({
          useRouter: () => ({ refresh: () => { throw new Error("Unexpected refresh"); } }),
        }));
        mock.module("@/app/admin/actions", () => ({
          updateOrganizationVerifiedStatus: () => { throw new Error("Unexpected mutation"); },
        }));
        const { OrganizationsTab } = await import(${JSON.stringify(`${import.meta.dir}/OrganizationsTab.tsx`)});
        process.stdout.write(renderToStaticMarkup(createElement(OrganizationsTab, {
          organizations: [{
            id: "fictional-organization", name: "Fictional Organization",
            username: "fictional-organization", type: "school", verified: false,
            created_at: ${JSON.stringify(createdAt)}, logo_url: null,
          }],
        })));
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          TZ: timezone,
          LANG: "en_US.UTF-8",
          NODE_ENV: "test",
        },
        timeout: 10_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const date = result.stdout.match(/>([A-Z][a-z]{2} \d{1,2}, \d{4})</u)?.[1];
    expect(date).toBe("Oct 18, 2026");
  });
}
