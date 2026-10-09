import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  WAIVER_SOURCE_REMOVE_LOCKED_MESSAGE,
  WAIVER_SOURCE_REPLACE_LOCKED_MESSAGE,
  isWaiverSourceLocked,
} from "./source-replacement-policy";

describe("isWaiverSourceLocked", () => {
  test("a published waiver-required project is locked", () => {
    expect(
      isWaiverSourceLocked({
        workflow_status: "published",
        waiver_required: true,
      }),
    ).toBe(true);
  });

  test("a missing workflow status counts as published, as in the trigger", () => {
    expect(isWaiverSourceLocked({ waiver_required: true })).toBe(true);
    expect(
      isWaiverSourceLocked({ workflow_status: null, waiver_required: true }),
    ).toBe(true);
  });

  test("drafts and projects without a waiver requirement stay editable", () => {
    expect(
      isWaiverSourceLocked({ workflow_status: "draft", waiver_required: true }),
    ).toBe(false);
    expect(
      isWaiverSourceLocked({
        workflow_status: "published",
        waiver_required: false,
      }),
    ).toBe(false);
    expect(
      isWaiverSourceLocked({
        workflow_status: "published",
        waiver_required: null,
      }),
    ).toBe(false);
  });
});

describe("waiver source actions", () => {
  const source = readFileSync(
    join(process.cwd(), "app/projects/[id]/server/waiver-assets.ts"),
    "utf8",
  );
  const upload = source.slice(
    source.indexOf("export async function uploadProjectWaiverPdf"),
    source.indexOf("export async function removeProjectWaiverPdf"),
  );
  const remove = source.slice(
    source.indexOf("export async function removeProjectWaiverPdf"),
  );

  test("the messages say exactly what is and is not possible", () => {
    expect(WAIVER_SOURCE_REPLACE_LOCKED_MESSAGE).toBe(
      "This project is published and requires a waiver, so its waiver PDF cannot be replaced here yet.",
    );
    expect(WAIVER_SOURCE_REMOVE_LOCKED_MESSAGE).toContain("cannot be removed");
  });

  test("both actions authorize first and check the lock before touching storage", () => {
    for (const [flow, message] of [
      [upload, "WAIVER_SOURCE_REPLACE_LOCKED_MESSAGE"],
      [remove, "WAIVER_SOURCE_REMOVE_LOCKED_MESSAGE"],
    ] as const) {
      const authorized = flow.indexOf("canCurrentUserManageProject(projectId)");
      const locked = flow.indexOf("isWaiverSourceLocked(");
      const storage = flow.indexOf(".storage");

      expect(authorized).toBeGreaterThan(0);
      expect(locked).toBeGreaterThan(authorized);
      expect(storage).toBeGreaterThan(locked);
      expect(flow).toContain(message);
    }
  });

  test("a password protected PDF is refused before it is stored", () => {
    const encrypted = upload.indexOf("isEncryptedPdf(");
    expect(encrypted).toBeGreaterThan(0);
    expect(upload.indexOf(".upload(")).toBeGreaterThan(encrypted);
    expect(upload).toContain("ENCRYPTED_WAIVER_PDF_MESSAGE");
  });
});
