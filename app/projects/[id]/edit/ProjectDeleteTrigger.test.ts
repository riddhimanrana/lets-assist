import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function renderTrigger(ready: boolean, canDelete = true, isDeleting = false) {
  const probe = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      "--eval",
      `
      import { mock } from "bun:test";
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      ${ready ? 'mock.module("@/hooks/useHydrated", () => ({ useHydrated: () => true }));' : ""}
      const { ProjectDeleteTrigger } = await import("./app/projects/[id]/edit/ProjectDeleteTrigger");
      process.stdout.write(renderToStaticMarkup(createElement(ProjectDeleteTrigger, {
        canDelete: ${canDelete}, isDeleting: ${isDeleting},
        onDeleteRequested: () => { throw new Error("Rendering must not request deletion"); },
      })));
      `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout);
  const button = probe.stdout.match(/<button\b[^>]*>/)?.[0];
  if (!button) throw new Error("The deletion trigger did not render.");
  return { button, html: probe.stdout };
}

test("server rendering disables deletion until the handler is ready", () => {
  const { button, html } = renderTrigger(false);
  expect(html).toContain("Delete Project");
  expect(button).toContain('disabled=""');
});

test("a ready eligible owner can open deletion confirmation", () => {
  expect(renderTrigger(true).button).not.toContain('disabled=""');
});

test("hydration never overrides the project deletion restriction", () => {
  expect(renderTrigger(true, false).button).toContain('disabled=""');
});

test("an in-progress deletion keeps its trigger disabled", () => {
  const { button, html } = renderTrigger(true, true, true);
  expect(button).toContain('disabled=""');
  expect(html).toContain("animate-spin");
});
