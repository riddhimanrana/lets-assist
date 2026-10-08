import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

for (const client of [false, true]) {
  test(`hours dialog trigger is ${client ? "enabled after hydration" : "disabled in server HTML"}`, () => {
    const result = spawnSync(
      "bun",
      [
        "-e",
        `
      import { mock } from "bun:test";
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      ${client ? 'mock.module("@/hooks/useHydrated", () => ({ useHydrated: () => true }));' : ""}
      const { AddVolunteerHoursModal } = await import(${JSON.stringify(`${import.meta.dir}/AddVolunteerHoursModal.tsx`)});
      process.stdout.write(renderToStaticMarkup(createElement(AddVolunteerHoursModal)));
    `,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Add self-reported hours");
    const button = result.stdout.match(/<button\b[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button!.includes('disabled=""')).toBe(!client);
  });
}
