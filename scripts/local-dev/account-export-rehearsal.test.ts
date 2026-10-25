import { expect, test } from "bun:test";
import { assertExportRehearsalSubject } from "./account-export-rehearsal";

const userId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";
const user = {
  id: userId,
  email: `export.worker.${userId}@local.test`,
  email_confirmed_at: "2026-10-07T00:00:00Z",
};
const job = {
  id: jobId,
  user_id: userId,
  status: "pending",
  protocol_version: 2,
};
test("only the verified fixture account and its sole pending export can reach the worker", () => {
  expect(() =>
    assertExportRehearsalSubject(userId, jobId, user, job, [{ id: jobId }]),
  ).not.toThrow();
  for (const changed of [
    { ...user, email: "person@example.com" },
    { ...user, email_confirmed_at: undefined },
    { ...user, id: jobId },
  ])
    expect(() =>
      assertExportRehearsalSubject(userId, jobId, changed, job, [
        { id: jobId },
      ]),
    ).toThrow("verified fictional account");
  for (const changed of [
    { ...job, user_id: jobId },
    { ...job, id: userId },
    { ...job, status: "processing" },
    { ...job, protocol_version: 1 },
  ])
    expect(() =>
      assertExportRehearsalSubject(userId, jobId, user, changed, [
        { id: jobId },
      ]),
    ).toThrow("owned pending protocol-2 job");
  for (const queue of [[], [{ id: userId }], [{ id: jobId }, { id: userId }]])
    expect(() =>
      assertExportRehearsalSubject(userId, jobId, user, job, queue),
    ).toThrow("another active export job");
  expect(() =>
    assertExportRehearsalSubject("invalid", jobId, user, job, [{ id: jobId }]),
  ).toThrow("identifiers");
});
