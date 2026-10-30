/**
 * The shared test preload must give Bun the AsyncLocalStorage that Next's
 * server runtime provides. Without it, one file importing next/headers and a
 * later file loading Next's server environment (as next/experimental/testing
 * does) make every console call in the process throw.
 *
 * The in-process checks rely on the runner applying the preload, as
 * scripts/run-tests.mjs does for this group. The child-process checks run a
 * fictional two-step import order with and without the preload.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const preload = "./scripts/local-dev/server-only-test-preload.ts";

describe("Next request context under the test preload", () => {
  test("a real AsyncLocalStorage is on globalThis before Next loads", () => {
    expect(globalThis.AsyncLocalStorage).toBe(AsyncLocalStorage);
  });

  test("Next's request stores are real and propagate across await", async () => {
    await import("next/headers");
    const { workUnitAsyncStorage } =
      await import("next/dist/server/app-render/work-unit-async-storage.external.js");
    expect(workUnitAsyncStorage).toBeInstanceOf(AsyncLocalStorage);

    const store = { type: "fictional-request" } as never;
    const seen = await workUnitAsyncStorage.run(store, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return workUnitAsyncStorage.getStore();
    });
    expect(seen).toBe(store);
    expect(workUnitAsyncStorage.getStore()).toBeUndefined();
  });

  test("console still works after Next's server environment loads", async () => {
    await import("next/experimental/testing/server");
    expect(() => console.debug("preload console probe")).not.toThrow();
  });
});

describe("cross-file import order in one process", () => {
  const directory = join(
    root,
    ".artifacts",
    "test-fixtures",
    `next-runtime-${process.pid}`,
  );
  mkdirSync(directory, { recursive: true });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  // Two files in one process, in the order the shared root group used.
  writeFileSync(
    join(directory, "a-headers.test.ts"),
    'import { test } from "bun:test";\ntest("loads headers", async () => { await import("next/headers"); });\n',
  );
  writeFileSync(
    join(directory, "b-server.test.ts"),
    'import { expect, test } from "bun:test";\ntest("console after server env", async () => { await import("next/experimental/testing/server"); expect(() => console.debug("probe")).not.toThrow(); });\n',
  );
  const run = (withPreload: boolean) =>
    spawnSync(
      process.execPath,
      [
        "test",
        "--no-env-file",
        ...(withPreload ? ["--preload", preload] : []),
        join(directory, "a-headers.test.ts"),
        join(directory, "b-server.test.ts"),
      ],
      { cwd: root, encoding: "utf8", timeout: 60_000 },
    );

  test("without the baseline, the later console call throws the Next invariant", () => {
    const result = run(false);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "AsyncLocalStorage accessed in runtime where it is not available",
    );
  }, 60_000);

  test("with the repository preload, both files pass", () => {
    const result = run(true);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  }, 60_000);
});
