import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDeletionCountdown } from "./account-deletion-countdown";

/** A manual clock, the same shape the export poller tests use. */
function fixture() {
  const deleteAccount = mock(() => {});
  const ticks: number[] = [];
  const timers = new Map<number, { callback: () => void; at: number }>();
  let timerId = 0;
  let now = 0;
  const countdown = createDeletionCountdown({
    seconds: 5,
    schedule: (callback, milliseconds) => {
      const id = ++timerId;
      timers.set(id, { callback, at: now + milliseconds });
      return id;
    },
    cancel: (handle) => {
      timers.delete(handle as number);
    },
    onTick: (remaining) => ticks.push(remaining),
    commit: deleteAccount,
  });
  const advance = (milliseconds: number) => {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].callback();
    }
    now = end;
  };
  return { countdown, deleteAccount, ticks, timers, advance };
}

describe("account deletion countdown", () => {
  test("dismissing during the countdown never deletes the account", () => {
    const { countdown, deleteAccount, ticks, timers, advance } = fixture();
    expect(countdown.start()).toBe(true);
    advance(2000);
    expect(ticks).toEqual([5, 4, 3]);

    countdown.cancel();
    expect(countdown.isCounting()).toBe(false);
    expect(timers.size).toBe(0);

    advance(60_000);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(ticks).toEqual([5, 4, 3]);
  });

  test("letting the countdown finish deletes exactly once", () => {
    const { countdown, deleteAccount, ticks, advance } = fixture();
    countdown.start();
    advance(4999);
    expect(deleteAccount).not.toHaveBeenCalled();
    advance(1);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(ticks).toEqual([5, 4, 3, 2, 1, 0]);

    advance(60_000);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(countdown.isCounting()).toBe(false);
  });

  test("a callback already queued when the user cancels cannot delete", () => {
    const deleteAccount = mock(() => {});
    const queued: (() => void)[] = [];
    const countdown = createDeletionCountdown({
      seconds: 1,
      schedule: (callback) => queued.push(callback),
      // A timer that has already left the queue cannot be cleared.
      cancel: () => {},
      onTick: () => {},
      commit: deleteAccount,
    });
    countdown.start();
    countdown.cancel();
    for (const callback of queued) callback();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  test("reopening starts a clean countdown instead of resuming the old one", () => {
    const { countdown, deleteAccount, ticks, advance } = fixture();
    countdown.start();
    advance(4000);
    countdown.cancel();

    expect(countdown.start()).toBe(true);
    expect(ticks.at(-1)).toBe(5);
    advance(4000);
    expect(deleteAccount).not.toHaveBeenCalled();
    advance(1000);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  test("a second confirm press during the countdown does not stack a run", () => {
    const { countdown, deleteAccount, timers, advance } = fixture();
    expect(countdown.start()).toBe(true);
    expect(countdown.start()).toBe(false);
    expect(timers.size).toBe(1);
    advance(10_000);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  test("the dialog routes every close request through the countdown", () => {
    const source = readFileSync(
      join(import.meta.dir, "AccountDeletionSection.tsx"),
      "utf8",
    );
    // Escape, outside press, and Cancel all reach Base UI's onOpenChange.
    expect(source).toContain("onOpenChange={handleOpenChange}");
    expect(source).toContain("<AlertDialogCancel>Cancel</AlertDialogCancel>");
    expect(source).toMatch(
      /if \(!nextOpen\) \{\s*deletionCountdown\.cancel\(\);/u,
    );
    expect(source).toContain(
      "useEffect(() => () => deletionCountdown.cancel()",
    );
    // The controller's commit is the only caller of the server action.
    expect(source.match(/await deleteAccount\(\)/gu)).toHaveLength(1);
    expect(source.match(/deleteAccount\(/gu)).toHaveLength(1);
    expect(source).not.toContain("setInterval");
  });
});
