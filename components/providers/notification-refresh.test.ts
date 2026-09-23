import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationRefreshScheduler } from "./notification-refresh";

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

test("a bulk notification update schedules one count/list refresh", async () => {
  let reads = 0;
  const scheduler = createNotificationRefreshScheduler(async () => {
    reads++;
  }, 1);
  for (let row = 0; row < 500; row++) scheduler.schedule();
  await settle();
  assert.equal(reads, 1);
  scheduler.dispose();
});

test("updates during an active read produce one trailing refresh", async () => {
  let reads = 0;
  let release: () => void = () => {};
  const scheduler = createNotificationRefreshScheduler(async () => {
    reads++;
    if (reads === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  }, 1);
  scheduler.schedule();
  await settle();
  for (let row = 0; row < 500; row++) scheduler.schedule();
  await settle();
  assert.equal(reads, 1);
  release();
  await settle();
  assert.equal(reads, 2);
  scheduler.dispose();
});

test("logout cancels pending and trailing work", async () => {
  let reads = 0;
  const scheduler = createNotificationRefreshScheduler(async () => {
    reads++;
  }, 1);
  scheduler.schedule();
  scheduler.dispose();
  scheduler.schedule();
  await settle();
  assert.equal(reads, 0);

  let release: () => void = () => {};
  const active = createNotificationRefreshScheduler(async () => {
    reads++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  }, 1);
  active.schedule();
  await settle();
  active.schedule();
  active.dispose();
  release();
  await settle();
  assert.equal(reads, 1);
});
