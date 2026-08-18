import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionsSource = readFileSync(
  `${process.cwd()}/app/projects/[id]/hours/actions.ts`,
  "utf8",
);
const certificateIssuanceSource = readFileSync(
  `${process.cwd()}/app/projects/[id]/hours/certificate-issuance.ts`,
  "utf8",
);
const publicationServiceSource = readFileSync(
  `${process.cwd()}/lib/projects/hours-publication-service.ts`,
  "utf8",
);
const publicationEmailServiceSource = readFileSync(
  `${process.cwd()}/lib/projects/hours-publication-email-service.ts`,
  "utf8",
);
const autoPublishSource = readFileSync(
  `${process.cwd()}/app/api/cron/auto-publish-hours/route.ts`,
  "utf8",
);

test("publishing hours authenticates before crossing the service-only RPC boundary", () => {
  const publishStart = actionsSource.indexOf(
    "export async function publishVolunteerHours",
  );
  const resendStart = actionsSource.indexOf(
    "export async function resendCertificateEmails",
  );
  const publishSource = actionsSource.slice(publishStart, resendStart);

  assert.ok(publishStart >= 0);
  const authenticateIndex = publishSource.indexOf("supabase.auth.getUser");
  const transactionIndex = publishSource.indexOf(
    "publishVolunteerHoursTransaction",
  );
  const emailDrainIndex = publishSource.indexOf("drainPublicationEmails");

  assert.ok(authenticateIndex >= 0 && authenticateIndex < transactionIndex);
  assert.ok(transactionIndex < emailDrainIndex);
  assert.match(publishSource, /actorId: user\.id/u);
  assert.match(publishSource, /publicationRequestKey/u);
  assert.match(publishSource, /normalizeHoursTimestamp/u);
  assert.match(publishSource, /drainPublicationEmails/u);
  assert.doesNotMatch(publishSource, /supabase\.rpc/u);
  assert.doesNotMatch(publishSource, /\.from\("certificates"\)\.insert/u);
  assert.doesNotMatch(publishSource, /\.from\("projects"\)\.update/u);
  assert.doesNotMatch(publishSource, /volunteer_name ===/u);
  assert.doesNotMatch(publishSource, /volunteer\.userId/u);
  assert.doesNotMatch(publishSource, /volunteer\.email/u);
});

test("the publication service uses one exact service-role request for bounded receipt recovery", () => {
  assert.match(publicationServiceSource, /import "server-only"/u);
  assert.match(publicationServiceSource, /getAdminClient\(\)/u);
  assert.match(publicationServiceSource, /p_actor_id: input\.actorId/u);
  assert.match(
    publicationServiceSource,
    /await admin\.rpc\("publish_volunteer_hours_transactional", rpcArguments\)/u,
  );
  assert.match(
    publicationServiceSource,
    /executeReplaySafeHoursPublicationRpc/u,
  );
  assert.doesNotMatch(publicationServiceSource, /auth\.uid|auth\.getUser/u);
  assert.doesNotMatch(
    publicationServiceSource,
    /sendEmail|drainPublicationEmails/u,
  );
});

test("certificate resend is permission checked and scoped to one project session", () => {
  const resendStart = actionsSource.indexOf(
    "export async function resendCertificateEmails",
  );
  const resendSource = actionsSource.slice(resendStart);

  assert.ok(resendStart >= 0);
  assert.match(resendSource, /canUserManageProjectHours/u);
  assert.match(resendSource, /getPublishStateKey/u);
  assert.match(resendSource, /loadDurablePublicationForRetry/u);
  assert.match(resendSource, /drainPublicationEmails/u);
  assert.match(
    resendSource,
    /publishKey === sessionId \? \[sessionId\] : \[sessionId, publishKey\]/u,
  );
  assert.match(resendSource, /\.eq\("project_id", projectId\)/u);
  assert.match(resendSource, /\.in\("schedule_id", legacyScheduleIds\)/u);
});

test("durable delivery snapshots the rendered provider request before claim", () => {
  const drainStart = publicationEmailServiceSource.indexOf(
    "export async function drainPublicationEmails",
  );
  const drainSource = publicationEmailServiceSource.slice(drainStart);
  const prepareIndex = drainSource.indexOf("preparePublicationEmailPayload");
  const claimIndex = drainSource.indexOf(
    "claim_hours_publication_email_delivery",
  );
  const sendIndex = drainSource.indexOf("await sendEmail");

  assert.ok(drainStart >= 0);
  assert.ok(prepareIndex >= 0 && prepareIndex < claimIndex);
  assert.ok(claimIndex < sendIndex);
  assert.match(drainSource, /to: providerPayload\.to/u);
  assert.match(drainSource, /from: providerPayload\.from/u);
  assert.match(drainSource, /html: providerPayload\.html/u);
  assert.match(drainSource, /tags: providerPayload\.tags/u);
});

test("the auto-publisher uses the atomic publication and durable email protocols", () => {
  const processStart = autoPublishSource.indexOf(
    "async function processSessionSignups",
  );
  const processEnd = autoPublishSource.indexOf(
    "async function processExpiredSessions",
  );
  const processSource = autoPublishSource.slice(processStart, processEnd);
  const transactionIndex = processSource.indexOf(
    "publishVolunteerHoursTransaction",
  );
  const emailDrainIndex = processSource.indexOf("drainPublicationEmails");

  assert.ok(processStart >= 0 && processEnd > processStart);
  assert.ok(transactionIndex >= 0 && transactionIndex < emailDrainIndex);
  assert.match(processSource, /actorId: project\.creator_id/u);
  assert.match(processSource, /autoPublicationRequestKey/u);
  assert.match(processSource, /isAutoPublished: true/u);
  assert.doesNotMatch(processSource, /\.from\("certificates"\)\.insert/u);
  assert.doesNotMatch(processSource, /\.from\("projects"\)\.update/u);
  assert.doesNotMatch(processSource, /sendCertificatePublishedEmails/u);
});

test("supplemental issuance delegates conflict arbitration to one database statement", () => {
  const issuanceStart = certificateIssuanceSource.indexOf(
    "export async function issueCertificatesForSignups",
  );
  const issuanceSource = certificateIssuanceSource.slice(issuanceStart);

  assert.ok(issuanceStart >= 0);
  assert.match(issuanceSource, /issue_supplemental_verified_certificates/u);
  assert.doesNotMatch(issuanceSource, /\.from\("certificates"\)\.insert/u);
  assert.doesNotMatch(issuanceSource, /alreadyIssued/u);
});
