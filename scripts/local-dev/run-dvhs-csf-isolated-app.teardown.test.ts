import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createOwnedChildSupervisor,
  forwardSignalToProcessGroup,
  resolveNodeExecutable,
} from "./run-dvhs-csf-isolated-app.mjs";

/**
 * The isolated app runner's port claim, across a real teardown.
 *
 * The claim is what makes port 3000 exclusive, so a claim the runner takes and
 * never gives back is worse than no claim at all: every later browser run is
 * refused by a directory whose owner is gone. This file covers the three ways
 * the runner can be asked to stop — a graceful Playwright teardown, a child
 * that will not leave, and a teardown that lands before the first child exists
 * — and asserts the same thing about all three: the claim directory is empty
 * afterwards.
 *
 * Nothing here starts Docker, Supabase, Next, or a browser. The children are
 * the stand-ins in run-dvhs-csf-isolated-app.teardown.fixture.mjs, and every
 * claim lives under its own temporary root.
 */

const fixture = join(
  process.cwd(),
  "scripts/local-dev/run-dvhs-csf-isolated-app.teardown.fixture.mjs",
);
// A real node, because the runner is a real node: signal delivery, process
// groups, and what an uncaught exception in a handler does are all runtime
// behaviour, and `process.execPath` under `bun test` is bun.
const nodeExecutable = resolveNodeExecutable();

const scratchRoots: string[] = [];
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone, which is the expected case.
      }
    }
  }
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function hermeticClaimRoot() {
  const root = mkdtempSync(join(tmpdir(), "lets-assist-teardown-claims-"));
  scratchRoots.push(root);
  return root;
}

/**
 * Launch a fixture runner the way Playwright launches the web server: its own
 * detached process group, so teardown can signal the group rather than one pid.
 */
function launchFixture(
  role: string,
  mode: string,
  claimRoot: string,
  env: Record<string, string> = {},
) {
  const child = spawn(nodeExecutable, [fixture, role, mode], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"] as const,
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      CSF_ISOLATED_CLAIM_ROOT: claimRoot,
      CSF_ISOLATED_TEST_CLAIM_ROOT: "hermetic-test",
      ...env,
    } as NodeJS.ProcessEnv,
  });
  running.push(child);

  let output = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    output += chunk;
  });
  const closed = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) => {
      child.once("close", (code: number | null, signal: string | null) =>
        resolve({ code, signal }),
      );
    },
  );

  const waitFor = async (predicate: (text: string) => boolean) => {
    const deadline = Date.now() + 30_000;
    while (!predicate(output)) {
      if (Date.now() > deadline) {
        throw new Error(
          `fixture never became ready. Output so far:\n${output}`,
        );
      }
      await Bun.sleep(10);
    }
  };

  return {
    child,
    closed,
    waitFor,
    get output() {
      return output;
    },
  };
}

function countReadyChildren(text: string) {
  return text.split("CHILD-READY").length - 1;
}

/**
 * Wait for the fixture to close, and fail loudly rather than hanging: a runner
 * that never exits is itself the defect, because Playwright would SIGKILL the
 * group and the claim would be left behind.
 */
async function closeWithin(
  fixtureRun: ReturnType<typeof launchFixture>,
  milliseconds: number,
) {
  const timeout = Bun.sleep(milliseconds).then(() => "timed-out" as const);
  const outcome = await Promise.race([fixtureRun.closed, timeout]);
  if (outcome === "timed-out") {
    throw new Error(
      `the fixture runner never exited. Output so far:\n${fixtureRun.output}`,
    );
  }
  return outcome;
}

describe("signalling an owned child's process group", () => {
  const stubbedKill = (code: string | undefined) => {
    const error = new Error(`kill ${code ?? "unknown"}`) as Error & {
      code?: string;
    };
    error.code = code;
    return () => {
      throw error;
    };
  };

  const withStubbedKill = (
    stub: (pid: number, signal: string) => unknown,
    body: () => void,
  ) => {
    const real = process.kill;
    process.kill = stub as typeof process.kill;
    try {
      body();
    } finally {
      process.kill = real;
    }
  };

  // The defect this whole file exists for: on Darwin a group whose only member
  // has exited but has not been reaped answers EPERM, not ESRCH. Rethrowing it
  // from a signal handler ended the runner with its claim still taken.
  test("a group that is already gone is not an error, however it says so", () => {
    for (const code of ["ESRCH", "EPERM"]) {
      const reported: string[] = [];
      withStubbedKill(stubbedKill(code), () => {
        expect(
          forwardSignalToProcessGroup(4321, "SIGTERM", (message) =>
            reported.push(message),
          ),
        ).toBe(false);
      });
      expect(reported).toEqual([]);
    }
  });

  test("an unexpected failure is reported rather than thrown", () => {
    const reported: string[] = [];
    withStubbedKill(stubbedKill("EINVAL"), () => {
      expect(
        forwardSignalToProcessGroup(4321, "SIGTERM", (message) =>
          reported.push(message),
        ),
      ).toBe(false);
    });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("SIGTERM");
    expect(reported[0]).toContain("4321");
  });

  test("a live group is signalled through its negative pid", () => {
    const calls: Array<[number, string]> = [];
    withStubbedKill(
      (pid, signal) => {
        calls.push([pid, signal]);
        return true;
      },
      () => {
        expect(forwardSignalToProcessGroup(4321, "SIGTERM")).toBe(true);
        // A child that never got a pid has no group to signal.
        expect(forwardSignalToProcessGroup(undefined, "SIGTERM")).toBe(false);
      },
    );
    expect(calls).toEqual([[-4321, "SIGTERM"]]);
  });
});

describe("the owned-child supervisor", () => {
  /**
   * Stand-in children, so the ordering contracts can be driven exactly rather
   * than waited on. The pids are fictional, so `process.kill` is stubbed for
   * the whole block: nothing here may signal a real process.
   */
  class FakeChild extends EventEmitter {
    constructor(readonly pid: number | undefined) {
      super();
    }
  }

  function supervisorWithFakeChildren() {
    const signalled: Array<[number, string]> = [];
    const released: number[] = [];
    const children: FakeChild[] = [];
    let nextPid = 9000;

    const realKill = process.kill;
    process.kill = ((pid: number, signal: string) => {
      signalled.push([pid, signal]);
      return true;
    }) as typeof process.kill;

    const supervisor = createOwnedChildSupervisor({
      release: () => {
        released.push(released.length);
        return true;
      },
      forcedShutdownDelayMs: 50,
      // No real signal disposition: this block owns the test process too.
      signals: [],
      spawnChild: (() => {
        const child = new FakeChild((nextPid += 1));
        children.push(child);
        return child;
      }) as never,
      report: () => {},
    });

    return {
      supervisor,
      children,
      signalled,
      released,
      restore: () => {
        process.kill = realKill;
      },
    };
  }

  test("the claim goes back only after every owned child is gone", async () => {
    const scope = supervisorWithFakeChildren();
    try {
      scope.supervisor.spawnOwnedChild("plugin", "node", [], {
        cwd: ".",
        env: {},
      });
      scope.supervisor.spawnOwnedChild("platform", "node", [], {
        cwd: ".",
        env: {},
      });
      const drained = scope.supervisor.drain();

      const [plugin, platform] = scope.children;
      plugin.emit("exit", 0, null);
      await Bun.sleep(10);
      // One child down is not the group down, so nothing is released yet.
      expect(scope.released).toEqual([]);

      platform.emit("exit", 0, null);
      const firstExit = await drained;
      expect(firstExit?.name).toBe("plugin");
      expect(scope.released).toEqual([]);

      expect(scope.supervisor.stop()).toBe(true);
      expect(scope.released).toEqual([0]);
      // Releasing twice would hand a live peer's port away.
      expect(scope.supervisor.stop()).toBe(false);
      expect(scope.released).toEqual([0]);
    } finally {
      scope.restore();
    }
  });

  test("the first exit makes the rest of the group leave too", async () => {
    const scope = supervisorWithFakeChildren();
    try {
      scope.supervisor.spawnOwnedChild("plugin", "node", [], {
        cwd: ".",
        env: {},
      });
      scope.supervisor.spawnOwnedChild("platform", "node", [], {
        cwd: ".",
        env: {},
      });
      const drained = scope.supervisor.drain();
      const [plugin, platform] = scope.children;

      plugin.emit("exit", 3, null);
      await Bun.sleep(10);
      expect(scope.signalled).toEqual([
        [-plugin.pid!, "SIGTERM"],
        [-platform.pid!, "SIGTERM"],
      ]);

      platform.emit("exit", 0, "SIGTERM");
      expect((await drained)?.code).toBe(3);
    } finally {
      scope.restore();
      scope.supervisor.stop();
    }
  });

  test("a child that never starts ends the run instead of stalling it", async () => {
    const scope = supervisorWithFakeChildren();
    try {
      const exit = scope.supervisor.spawnOwnedChild("platform", "node", [], {
        cwd: ".",
        env: {},
      });
      scope.children[0].emit("error", new Error("spawn ENOENT"));
      expect(await exit).toEqual({ name: "platform", code: 1, signal: null });
      expect(await scope.supervisor.drain()).toEqual({
        name: "platform",
        code: 1,
        signal: null,
      });
    } finally {
      scope.restore();
      scope.supervisor.stop();
    }
  });
});

describe("the isolated app runner gives its port claim back", () => {
  test("after the exact Playwright graceful teardown", async () => {
    const claimRoot = hermeticClaimRoot();
    const run = launchFixture("supervised", "graceful", claimRoot, {
      // The window the second signal lands in. See the fixture.
      CSF_TEARDOWN_FIXTURE_KILL_FAULT: "eperm-after-first",
    });
    await run.waitFor(
      (text) => text.includes("RUNNER-READY") && countReadyChildren(text) === 2,
    );
    expect(readdirSync(claimRoot)).toEqual(["app-port-3000"]);

    // Playwright signals the whole web-server process group...
    process.kill(-run.child.pid!, "SIGTERM");
    await run.waitFor((text) => text.split("GROUP-SIGNALLED").length - 1 === 2);
    // ...and the bootstrap it launched forwards the same signal to the runner.
    // That second forward is the one that lands in the window where the owned
    // groups have exited but have not been reaped.
    run.child.kill("SIGTERM");

    const outcome = await closeWithin(run, 20_000);
    expect(run.output).not.toContain("Error: kill EPERM");
    expect(run.output).toContain("RELEASED true");
    expect(outcome.signal).toBeNull();
    expect(readdirSync(claimRoot)).toEqual([]);
  });

  test("after a child that has to be force-killed", async () => {
    const claimRoot = hermeticClaimRoot();
    const run = launchFixture("supervised", "stubborn", claimRoot, {
      CSF_TEARDOWN_FIXTURE_FORCED_DELAY_MS: "500",
    });
    await run.waitFor(
      (text) => text.includes("RUNNER-READY") && countReadyChildren(text) === 2,
    );

    process.kill(-run.child.pid!, "SIGTERM");

    const outcome = await closeWithin(run, 20_000);
    expect(run.output).toContain("RELEASED true");
    expect(outcome.signal).toBeNull();
    expect(readdirSync(claimRoot)).toEqual([]);
  });

  test("after a teardown that lands before the first child exists", async () => {
    const claimRoot = hermeticClaimRoot();
    const run = launchFixture("build-window", "graceful", claimRoot);
    await run.waitFor((text) => text.includes("RUNNER-READY"));
    expect(readdirSync(claimRoot)).toEqual(["app-port-3000"]);

    process.kill(-run.child.pid!, "SIGTERM");

    const outcome = await closeWithin(run, 20_000);
    // The runner must not answer a teardown by carrying on into a build.
    expect(run.output).toContain("BUILD-ABORTED");
    expect(run.output).not.toContain("BUILD-COMPLETED");
    expect(run.output).toContain("RELEASED true");
    expect(outcome.code).toBe(1);
    expect(readdirSync(claimRoot)).toEqual([]);
  }, 25_000);
});
