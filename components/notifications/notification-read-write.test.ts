import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeReadStateOptimistically } from "./notification-read-write";

/** Stands in for the provider's unread count and its functional setter. */
function counter(initial: number) {
  let value = initial;
  return {
    get value() {
      return value;
    },
    set: (next: number | ((current: number) => number)) => {
      value = typeof next === "function" ? next(value) : next;
    },
  };
}

function markOne(
  count: ReturnType<typeof counter>,
  write: () => PromiseLike<{ error: unknown }>,
  reconcile?: () => Promise<void>,
) {
  const onError = mock((_error: unknown) => {});
  const done = writeReadStateOptimistically({
    apply: () => count.set((current) => Math.max(0, current - 1)),
    write,
    rollback: () => count.set((current) => current + 1),
    reconcile,
    onError,
  });
  return { done, onError };
}

describe("optimistic mark as read", () => {
  test("a successful write keeps the decremented count", async () => {
    const count = counter(3);
    const reconcile = mock(async () => {});
    const { done, onError } = markOne(
      count,
      async () => ({ error: null }),
      reconcile,
    );
    expect(count.value).toBe(2);
    expect(await done).toBe(true);
    expect(count.value).toBe(2);
    expect(onError).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("a resolved PostgREST error restores the count", async () => {
    const count = counter(3);
    const postgrestError = { code: "42501", message: "synthetic denial" };
    const { done, onError } = markOne(count, async () => ({
      error: postgrestError,
    }));
    expect(count.value).toBe(2);
    expect(await done).toBe(false);
    expect(count.value).toBe(3);
    expect(onError).toHaveBeenCalledWith(postgrestError);
  });

  test("a thrown error restores the count", async () => {
    const count = counter(3);
    const failure = new Error("synthetic network failure");
    const { done, onError } = markOne(count, async () => {
      throw failure;
    });
    expect(count.value).toBe(2);
    expect(await done).toBe(false);
    expect(count.value).toBe(3);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  test("mark all read restores the previous count on a resolved error and on a throw", async () => {
    for (const write of [
      async () => ({ error: { message: "synthetic denial" } }),
      async (): Promise<{ error: unknown }> => {
        throw new Error("synthetic network failure");
      },
    ]) {
      const count = counter(7);
      const previous = count.value;
      const ok = await writeReadStateOptimistically({
        apply: () => count.set(0),
        write,
        rollback: () => count.set(previous),
        onError: () => {},
      });
      expect(ok).toBe(false);
      expect(count.value).toBe(7);
    }
  });

  test("after a failure the server count wins when it can be read", async () => {
    const count = counter(3);
    const { done } = markOne(
      count,
      async () => ({ error: { message: "synthetic denial" } }),
      async () => count.set(5),
    );
    await done;
    expect(count.value).toBe(5);
  });

  test("a failed reconcile leaves the rolled-back count in place", async () => {
    const count = counter(3);
    const { done, onError } = markOne(
      count,
      async () => ({ error: { message: "synthetic denial" } }),
      async () => {
        throw new Error("synthetic count failure");
      },
    );
    expect(await done).toBe(false);
    expect(count.value).toBe(3);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  test("the popover sends every read write through the helper", () => {
    const source = readFileSync(
      join(import.meta.dir, "NotificationPopover.tsx"),
      "utf8",
    );
    expect(source.match(/\.update\(\{ read: true \}\)/gu)).toHaveLength(2);
    expect(source.match(/writeReadStateOptimistically\(\{/gu)).toHaveLength(2);
    expect(source.match(/reconcile: reconcileUnreadCount/gu)).toHaveLength(2);
    // The inbox is presentational and must not grow its own write path.
    const inbox = readFileSync(
      join(import.meta.dir, "NotificationInbox.tsx"),
      "utf8",
    );
    expect(inbox).not.toContain(".update(");
    expect(inbox).not.toContain("setUnreadCount");
  });
});
