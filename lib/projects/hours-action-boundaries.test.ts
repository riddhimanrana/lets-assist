import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionsSource = readFileSync(
  `${process.cwd()}/app/projects/[id]/hours/actions.ts`,
  "utf8",
);

test("publishing hours enforces canonical project-management access", () => {
  const publishStart = actionsSource.indexOf(
    "export async function publishVolunteerHours",
  );
  const resendStart = actionsSource.indexOf(
    "export async function resendCertificateEmails",
  );
  const publishSource = actionsSource.slice(publishStart, resendStart);

  assert.ok(publishStart >= 0);
  assert.match(publishSource, /canUserManageProjectHours/u);
  assert.match(
    publishSource,
    /Unauthorized: You cannot publish hours for this project/u,
  );
  assert.ok(
    publishSource.indexOf("canUserManageProjectHours") <
      publishSource.indexOf('.from("certificates")'),
  );
});

test("certificate resend is permission checked and scoped to one project session", () => {
  const resendStart = actionsSource.indexOf(
    "export async function resendCertificateEmails",
  );
  const resendSource = actionsSource.slice(resendStart);

  assert.ok(resendStart >= 0);
  assert.match(resendSource, /canUserManageProjectHours/u);
  assert.match(resendSource, /\.eq\("project_id", projectId\)/u);
  assert.match(resendSource, /\.eq\("schedule_id", sessionId\)/u);
});
