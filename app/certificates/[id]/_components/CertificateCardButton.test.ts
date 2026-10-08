import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("certificate project link renders without calling a client export", () => {
  const result = spawnSync(
    "bun",
    [
      "-e",
      `
    import { mock } from "bun:test";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    mock.module("@/components/ui/button", () => ({
      Button: () => createElement("button", { disabled: true }, "Project unavailable"),
      buttonVariants: () => { throw new Error("Cannot call a client export on the server"); },
    }));
    const { CertificateCardButton } = await import(${JSON.stringify(`${import.meta.dir}/CertificateCardButton.tsx`)});
    process.stdout.write(renderToStaticMarkup(createElement(CertificateCardButton, { projectId: "fictional-project" })));
  `,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('href="/projects/fictional-project"');
  expect(result.stdout).toContain("View project details");
  expect(result.stdout).toContain("border-border");
});
