#!/usr/bin/env node

/**
 * The teardown fixture for scripts/local-dev/run-dvhs-csf-isolated-app.mjs.
 *
 * It exists because the runner's port-claim lifetime is a property of real
 * signal dispositions in a real process, and nothing in-process can stand in
 * for that. So this runs the *real* `claimAppPort`, `createOwnedChildSupervisor`
 * and `releaseAppPort` against stand-in children that cost a few milliseconds
 * instead of a Docker stack, a Supabase project, and two Next builds.
 *
 * Roles, selected by argv[2]:
 *
 *   child        a stand-in Next child: `graceful` leaves on SIGTERM,
 *                `stubborn` ignores it and has to be killed;
 *   supervised   the runner's own shape — claim, supervisor, two owned
 *                children, drain, stop;
 *   build-window the runner between its claim and its first child, where the
 *                isolated browser profile spends minutes in a production build.
 *
 * Both runner roles announce `RUNNER-READY` on stderr once they are in the
 * state under test, and children announce `CHILD-READY`, so the caller signals
 * a process that is actually ready to be signalled rather than one that is
 * still starting.
 */

import { spawnSync } from "node:child_process";

import {
  claimAppPort,
  createOwnedChildSupervisor,
  releaseAppPort,
} from "./run-dvhs-csf-isolated-app.mjs";

const role = process.argv[2];
const mode = process.argv[3] ?? "graceful";

function announce(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Darwin answers `kill(-pgid)` with EPERM — not ESRCH — while the group's only
 * member has exited but has not yet been reaped, and a teardown that signals
 * twice in quick succession lands in exactly that window. The window is a few
 * milliseconds wide, so reproducing it by racing real processes is a coin flip.
 * Injecting the kernel's documented answer makes the regression deterministic
 * while leaving every other part of the path real.
 *
 * @param {string} fault
 */
function installKillFault(fault) {
  if (!fault) return;
  if (fault !== "eperm-after-first") {
    throw new Error(`Unknown teardown fixture kill fault: ${fault}`);
  }
  const realKill = process.kill.bind(process);
  const signalledGroups = new Set();
  process.kill = (pid, signal) => {
    if (pid >= 0) return realKill(pid, signal);
    if (signalledGroups.has(pid)) {
      const error = new Error("kill EPERM");
      error.code = "EPERM";
      error.errno = -1;
      error.syscall = "kill";
      throw error;
    }
    signalledGroups.add(pid);
    const result = realKill(pid, signal);
    // Announced so the caller can send its second signal *after* this one was
    // handled. Two signals sent back to back coalesce into a single delivery,
    // which is the one shape that would not reproduce the defect.
    announce(`GROUP-SIGNALLED ${pid} ${signal}`);
    return result;
  };
}

function runChild() {
  const hold = setInterval(() => {}, 1_000);
  if (mode === "stubborn") {
    process.on("SIGTERM", () => {});
    process.on("SIGINT", () => {});
  } else if (mode === "graceful") {
    // Not instant. A real Next server takes a moment to close its listeners,
    // and that moment is when the runner is still draining and the second
    // teardown signal arrives.
    const leave = () => {
      setTimeout(() => {
        clearInterval(hold);
        process.exit(0);
      }, 250).unref();
    };
    process.on("SIGTERM", leave);
    process.on("SIGINT", leave);
  } else {
    throw new Error(`Unknown teardown fixture child mode: ${mode}`);
  }
  announce(`CHILD-READY ${process.pid}`);
}

async function runSupervised() {
  installKillFault(process.env.CSF_TEARDOWN_FIXTURE_KILL_FAULT ?? "");
  const claim = claimAppPort();
  const supervisor = createOwnedChildSupervisor({
    release: () => releaseAppPort(claim),
    forcedShutdownDelayMs: Number(
      process.env.CSF_TEARDOWN_FIXTURE_FORCED_DELAY_MS ?? "5000",
    ),
  });
  announce(`CLAIMED ${claim.claimPath}`);
  try {
    for (const name of ["plugin application", "platform application"]) {
      supervisor.spawnOwnedChild(
        name,
        process.execPath,
        [new URL(import.meta.url).pathname, "child", mode],
        { cwd: process.cwd(), env: { ...process.env } },
      );
    }
    announce("RUNNER-READY");
    const firstExit = await supervisor.drain();
    announce(`DRAINED ${firstExit?.name} code=${firstExit?.code}`);
  } finally {
    announce(`RELEASED ${supervisor.stop()}`);
  }
}

async function runBuildWindow() {
  const claim = claimAppPort();
  const supervisor = createOwnedChildSupervisor({
    release: () => releaseAppPort(claim),
  });
  announce(`CLAIMED ${claim.claimPath}`);
  try {
    announce("RUNNER-READY");
    // A stand-in for `next build`: a plain child in this process group, exactly
    // like the real build, so a group signal ends it the same way.
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore",
    });
    await supervisor.checkpoint();
    announce("BUILD-COMPLETED");
  } catch (error) {
    announce(`BUILD-ABORTED ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    announce(`RELEASED ${supervisor.stop()}`);
  }
}

if (role === "child") {
  runChild();
} else if (role === "supervised") {
  await runSupervised();
} else if (role === "build-window") {
  await runBuildWindow();
} else {
  throw new Error(`Unknown teardown fixture role: ${role}`);
}
