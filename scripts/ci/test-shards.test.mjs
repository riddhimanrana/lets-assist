import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
  canonicalFiles,
  parseShard,
  partitionFiles,
  selectShard,
  shardFromArguments,
} from "./test-shards.mjs";

const repositoryRoot = join(import.meta.dir, "../..");
const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories)
    rmSync(directory, { recursive: true, force: true });
});

function sampleFiles(count) {
  return Array.from(
    { length: count },
    (_, index) =>
      `${["app", "lib", "services", "scripts"][index % 4]}/area-${index % 7}/file-${index}.test.ts`,
  );
}

function shuffled(files, seed) {
  // Deterministic shuffle: the test must not depend on Math.random.
  const copy = [...files];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const other = state % (index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

describe("test shard partition", () => {
  test("the shards together are exactly the inventory, with no overlap", () => {
    for (const count of [0, 1, 2, 3, 7, 50, 1247]) {
      const files = sampleFiles(count);
      for (const total of [1, 2, 3, 4, 5]) {
        const shards = partitionFiles(files, total);
        expect(shards).toHaveLength(total);
        const union = shards.flat();
        expect(union).toHaveLength(files.length);
        expect(new Set(union).size).toBe(files.length);
        expect([...union].sort()).toEqual([...files].sort());
        const sizes = shards.map((shard) => shard.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("a file lands in the same shard on every run and for every discovery order", () => {
    const files = sampleFiles(200);
    const reference = partitionFiles(files, 3);
    expect(partitionFiles(files, 3)).toEqual(reference);
    for (const seed of [1, 2, 3, 99]) {
      expect(partitionFiles(shuffled(files, seed), 3)).toEqual(reference);
    }
    // Duplicates in the input never run a file twice or move another file.
    expect(partitionFiles([...files, ...files.slice(0, 40)], 3)).toEqual(
      reference,
    );
    for (let index = 1; index <= 3; index += 1) {
      expect(selectShard(shuffled(files, 7), { index, total: 3 })).toEqual(
        reference[index - 1],
      );
    }
  });

  test("ordering never depends on the machine's locale", () => {
    const files = ["b.test.ts", "B.test.ts", "a.test.ts", "ä.test.ts", "_.ts"];
    expect(canonicalFiles(files)).toEqual([
      "B.test.ts",
      "_.ts",
      "a.test.ts",
      "b.test.ts",
      "ä.test.ts",
    ]);
  });

  test("no shard option runs the whole inventory", () => {
    const files = sampleFiles(10);
    expect(selectShard(files, null)).toEqual([...files].sort());
    expect(shardFromArguments(["--application-only"])).toBeNull();
  });

  test("a share can be empty only when there are fewer files than shards", () => {
    expect(partitionFiles(["only.test.ts"], 3)).toEqual([
      ["only.test.ts"],
      [],
      [],
    ]);
    for (const total of [1, 2, 3, 4]) {
      expect(
        partitionFiles(sampleFiles(total), total).every(
          (shard) => shard.length === 1,
        ),
      ).toBe(true);
    }
  });

  test("an invalid shard argument is rejected", () => {
    for (const value of [
      "",
      "1",
      "0/2",
      "3/2",
      "1/0",
      "-1/2",
      "1/-2",
      "a/b",
      "1/2/3",
      "1.5/2",
      " 1/2",
      "1/2 ",
      "01/2",
      "1/33",
      "1/1000",
      undefined,
    ]) {
      expect(() => parseShard(value), String(value)).toThrow("Invalid shard");
    }
    expect(parseShard("1/1")).toEqual({ index: 1, total: 1 });
    expect(parseShard("2/3")).toEqual({ index: 2, total: 3 });
    expect(parseShard("32/32")).toEqual({ index: 32, total: 32 });

    expect(shardFromArguments(["--shard=2/3"])).toEqual({ index: 2, total: 3 });
    for (const args of [
      ["--shard"],
      ["--shard", "1/2"],
      ["--shard=1/2", "--shard=2/2"],
      ["--shards=1/2"],
      ["--shard=0/2"],
    ]) {
      expect(() => shardFromArguments(args), args.join(" ")).toThrow(
        "Invalid shard",
      );
    }
    for (const total of [0, -1, 1.5, 33, Number.NaN]) {
      expect(() => partitionFiles(["a.test.ts"], total)).toThrow(
        "Invalid shard total",
      );
    }
  });
});

function list(...args) {
  const result = spawnSync(
    "node",
    ["scripts/run-tests.mjs", "--list", ...args],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  return {
    status: result.status,
    stderr: result.stderr,
    files: result.stdout.split("\n").filter(Boolean),
  };
}

describe("the test orchestrator's shards", () => {
  test("cover the real inventory exactly, for both shard counts CI uses", () => {
    const whole = list();
    expect(whole.status, whole.stderr).toBe(0);
    expect(whole.files.length).toBeGreaterThan(100);
    expect(new Set(whole.files).size).toBe(whole.files.length);

    for (const total of [2, 3]) {
      const shards = [];
      for (let index = 1; index <= total; index += 1) {
        const shard = list(`--shard=${index}/${total}`);
        expect(shard.status, shard.stderr).toBe(0);
        shards.push(shard.files);
      }
      const union = shards.flat();
      expect(union).toHaveLength(whole.files.length);
      expect(new Set(union).size).toBe(whole.files.length);
      expect([...union].sort()).toEqual([...whole.files].sort());
      const sizes = shards.map((shard) => shard.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      // Asking again gives the same answer.
      expect(list(`--shard=1/${total}`).files).toEqual(shards[0]);
    }
  }, 120_000);

  test("the scoped inventories shard the same way", () => {
    for (const scope of ["--application-only", "--private-only"]) {
      const whole = list(scope);
      expect(whole.status, whole.stderr).toBe(0);
      const union = [
        ...list(scope, "--shard=1/2").files,
        ...list(scope, "--shard=2/2").files,
      ];
      expect([...union].sort()).toEqual([...whole.files].sort());
      expect(new Set(union).size).toBe(union.length);
    }
  }, 120_000);

  test("rejects a malformed shard instead of running everything or nothing", () => {
    for (const argument of [
      "--shard=0/2",
      "--shard=3/2",
      "--shard=x",
      "--shard",
      "--shard=1/2 --shard=2/2",
    ]) {
      const result = list(...argument.split(" "));
      expect(result.status, argument).not.toBe(0);
      expect(result.files, argument).toEqual([]);
      expect(result.stderr, argument).toMatch(
        /Invalid shard|Unknown test-runner argument/u,
      );
    }
  }, 60_000);

  test("an empty share passes with a clear line while its sibling runs the file", () => {
    // A tiny repository with one plugin test and two shards: one share is
    // legitimately empty, and the other must still run the only file.
    const directory = mkdtempSync(join(tmpdir(), "lets-assist-shards-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "scripts/ci"), { recursive: true });
    mkdirSync(join(directory, "scripts/local-dev"), { recursive: true });
    mkdirSync(join(directory, "lib/plugins"), { recursive: true });
    for (const file of [
      "scripts/run-tests.mjs",
      "scripts/ci/test-shards.mjs",
      "scripts/local-dev/server-only-test-preload.ts",
    ]) {
      cpSync(join(repositoryRoot, file), join(directory, file));
    }
    symlinkSync(
      join(repositoryRoot, "node_modules"),
      join(directory, "node_modules"),
    );
    writeFileSync(
      join(directory, "lib/plugins/only.test.ts"),
      'import { expect, test } from "bun:test";\ntest("runs", () => expect(1).toBe(1));\n',
    );
    const run = (shard) =>
      spawnSync(
        "node",
        ["scripts/run-tests.mjs", "--plugins-only", `--shard=${shard}`],
        { cwd: directory, encoding: "utf8" },
      );

    const ran = run("1/2");
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("[test] shard 1/2: 1 of 1 test files.");
    expect(`${ran.stdout}${ran.stderr}`).toContain("1 pass");

    const empty = run("2/2");
    expect(empty.status, empty.stderr).toBe(0);
    expect(empty.stdout).toContain("[test] shard 2/2: 0 of 1 test files.");
    expect(empty.stdout).toContain(
      "[test] shard 2/2: no test files in this share; passing.",
    );
    expect(`${empty.stdout}${empty.stderr}`).not.toContain("1 pass");

    // An empty inventory is still a failure, sharded or not.
    rmSync(join(directory, "lib/plugins/only.test.ts"));
    const none = run("1/2");
    expect(none.status).not.toBe(0);
    expect(none.stderr).toContain("No plugin test files were discovered.");
  }, 60_000);
});
