import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionsSource = readFileSync(
  `${process.cwd()}/app/projects/[id]/hours/actions.ts`,
  "utf8",
);

test("publishing hours delegates identity and permission checks to one transactional RPC", () => {
  const publishStart = actionsSource.indexOf(
    "export async function publishVolunteerHours",
  );
  const resendStart = actionsSource.indexOf(
    "export async function resendCertificateEmails",
  );
  const publishSource = actionsSource.slice(publishStart, resendStart);

  assert.ok(publishStart >= 0);
  assert.match(publishSource, /publish_volunteer_hours_transactional/u);
  assert.match(publishSource, /publicationRequestKey/u);
  assert.match(publishSource, /drainPublicationEmails/u);
  assert.doesNotMatch(publishSource, /\.from\("certificates"\)\.insert/u);
  assert.doesNotMatch(publishSource, /\.from\("projects"\)\.update/u);
  assert.doesNotMatch(publishSource, /volunteer_name ===/u);
  assert.doesNotMatch(publishSource, /volunteer\.userId/u);
  assert.doesNotMatch(publishSource, /volunteer\.email/u);
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
