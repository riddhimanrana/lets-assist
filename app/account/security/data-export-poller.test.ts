import { describe, expect, test } from "bun:test";
import { createExportPoller } from "./data-export-poller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  let visible = true;
  let poll = true;
  let errors = 0;
  const requests: ReturnType<typeof deferred<string>>[] = [];
  const applied: string[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const controller = createExportPoller({
    read: () => {
      const request = deferred<string>();
      requests.push(request);
      return request.promise;
    },
    apply: (value) => {
      applied.push(value);
      return poll;
    },
    onError: () => {
      errors += 1;
    },
    visible: () => visible,
    schedule: (callback, milliseconds) => {
      expect(milliseconds).toBe(10_000);
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    cancel: (handle) => {
      timers.delete(handle as number);
    },
  });
  return {
    controller,
    requests,
    applied,
    timers,
    errors: () => errors,
    visible: (value: boolean) => {
      visible = value;
      controller.visibilityChanged();
    },
    poll: (value: boolean) => {
      poll = value;
    },
  };
}

describe("account export polling", () => {
  test("waits for a read to finish before scheduling another", async () => {
    const f = fixture();
    const first = f.controller.refresh();
    expect(f.requests).toHaveLength(1);
    expect(f.timers.size).toBe(0);
    f.requests[0].resolve("queued");
    await first;
    expect(f.applied).toEqual(["queued"]);
    expect(f.timers.size).toBe(1);
    f.controller.stop();
    expect(f.timers.size).toBe(0);
  });

  test("coalesces repeated refreshes without overlapping requests", async () => {
    const f = fixture();
    const first = f.controller.refresh();
    await f.controller.refresh();
    await f.controller.refresh();
    expect(f.requests).toHaveLength(1);
    f.requests[0].resolve("old");
    await first;
    expect(f.requests).toHaveLength(2);
    expect(f.timers.size).toBe(0);
    f.controller.stop();
    f.requests[1].resolve("latest");
  });

  test("drops in-flight history older than a recorded request", async () => {
    const f = fixture();
    const first = f.controller.refresh();
    f.controller.invalidate();
    f.requests[0].resolve("old request");
    await first;
    expect(f.applied).toEqual([]);
    expect(f.requests).toHaveLength(2);
    f.requests[1].resolve("recorded request");
    await Promise.resolve();
    expect(f.applied).toEqual(["recorded request"]);
    f.controller.stop();
  });

  test("pauses while hidden and refreshes once visible", async () => {
    const f = fixture();
    const first = f.controller.refresh();
    f.requests[0].resolve("pending");
    await first;
    f.visible(false);
    expect(f.timers.size).toBe(0);
    await f.controller.refresh();
    expect(f.requests).toHaveLength(1);
    f.visible(true);
    expect(f.requests).toHaveLength(2);
    f.controller.stop();
    f.requests[1].resolve("ready");
  });

  test("terminal status stops automatic polling", async () => {
    const f = fixture();
    f.poll(false);
    const read = f.controller.refresh();
    f.requests[0].resolve("ready and email accepted");
    await read;
    expect(f.timers.size).toBe(0);
  });

  test("unmount suppresses late results and further reads", async () => {
    const f = fixture();
    const read = f.controller.refresh();
    f.controller.stop();
    f.requests[0].resolve("late");
    await read;
    await f.controller.refresh();
    expect(f.applied).toEqual([]);
    expect(f.timers.size).toBe(0);
    expect(f.requests).toHaveLength(1);
  });

  test("read failures report an error and allow an explicit retry", async () => {
    const f = fixture();
    const read = f.controller.refresh();
    f.requests[0].reject(new Error("offline"));
    await read;
    expect(f.errors()).toBe(1);
    expect(f.timers.size).toBe(0);
    const retry = f.controller.refresh();
    f.requests[1].resolve("recovered");
    await retry;
    expect(f.applied).toEqual(["recovered"]);
    f.controller.stop();
  });

  test("stale failures do not replace status from a newer recorded request", async () => {
    const f = fixture();
    const read = f.controller.refresh();
    f.controller.invalidate();
    f.requests[0].reject(new Error("stale failure"));
    await read;
    expect(f.errors()).toBe(0);
    expect(f.requests).toHaveLength(2);
    f.controller.stop();
    f.requests[1].resolve("fresh");
  });
});
