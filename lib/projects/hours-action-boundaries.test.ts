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
  `${process.cwd()}/services/auto-publish-hours-worker.ts`,
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
    /publish_volunteer_hours_transactional_automatic/u,
  );
  assert.match(publicationServiceSource, /input\.origin === "automatic"/u);
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
    /getScheduleIdAliases\(typedProject, sessionId\)/u,
  );
  assert.match(resendSource, /\.eq\("project_id", projectId\)/u);
  assert.match(resendSource, /\.in\("schedule_id", legacyScheduleIds\)/u);
});

test("project-hours management requires an active organization membership", () => {
  const helperStart = actionsSource.indexOf(
    "async function canUserManageProjectHours",
  );
  const helperEnd = actionsSource.indexOf(
    "function publicationRequestKey",
    helperStart,
  );
  const helperSource = actionsSource.slice(helperStart, helperEnd);

  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.match(helperSource, /\.from\("organization_members"\)/u);
  assert.match(helperSource, /\.eq\("status", "active"\)/u);
  assert.match(helperSource, /canManageProjectAccess/u);
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
  const publishSource = processSource.slice(
    0,
    processSource.indexOf("async function claimDueSessions"),
  );

  assert.ok(processStart >= 0 && processEnd > processStart);
  assert.match(publishSource, /publishVolunteerHoursTransaction/u);
  assert.match(publishSource, /actorId: project\.creator_id/u);
  assert.match(publishSource, /autoPublicationRequestKey/u);
  assert.match(publishSource, /origin: "automatic"/u);
  assert.match(publishSource, /claimedSnapshot: true/u);
  // Publication commits durable email work. It never sends inline.
  assert.doesNotMatch(publishSource, /drainPublicationEmails\(/u);
  assert.doesNotMatch(autoPublishSource, /sendCertificatePublishedEmails/u);
  assert.doesNotMatch(autoPublishSource, /sendEmail/u);
  // Discovery and recovery are database claims. The worker reads no table,
  // so no Data API row cap can shorten a session snapshot.
  assert.doesNotMatch(autoPublishSource, /\.from\(/u);
  assert.match(autoPublishSource, /"claim_due_hours_publications"/u);
  assert.match(autoPublishSource, /"claim_hours_publication_email_recovery"/u);
  assert.match(
    publicationServiceSource,
    /publish_claimed_volunteer_hours_automatic/u,
  );
  assert.match(publicationEmailServiceSource, /\[Auto-Published\]/u);
  assert.match(
    publicationEmailServiceSource,
    /publication\.publicationOrigin === "automatic"/u,
  );
});

test("supplemental issuance delegates conflict arbitration to one database statement", () => {
  const issuanceStart = certificateIssuanceSource.indexOf(
    "export async function issueCertificatesForSignups",
  );
  const issuanceSource = certificateIssuanceSource.slice(issuanceStart);

  assert.ok(issuanceStart >= 0);
  assert.match(issuanceSource, /recoverSupplementalCertificates/u);
  assert.match(
    publicationServiceSource,
    /"recover_supplemental_verified_certificates"/u,
  );
  assert.doesNotMatch(issuanceSource, /\.from\("certificates"\)\.insert/u);
  assert.doesNotMatch(issuanceSource, /alreadyIssued/u);
  // Awards and their email work commit together, and delivery goes through
  // the ledger. This path never inserts a notification or sends directly.
  assert.match(issuanceSource, /drainPublicationEmails/u);
  assert.doesNotMatch(issuanceSource, /sendCertificatePublishedEmails/u);
  assert.doesNotMatch(issuanceSource, /sendEmail\(/u);
  assert.doesNotMatch(issuanceSource, /\.from\("notifications"\)/u);
});
