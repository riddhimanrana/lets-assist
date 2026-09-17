import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "../../../scripts/local-dev/dv-local-env.mjs";
import { loadCsfFeedFixture, type CsfFeedFixture } from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localActors,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

/**
 * The personal notice path, end to end, in the browser and the local mailbox.
 *
 * An officer reviews one member's point submission. The database records a
 * notice for that member and nobody else, the notice worker turns it into an
 * in-app notification whose headline names the chapter and the activity, the
 * button on it opens the tab that actually renders that submission, and the
 * mail worker delivers one message to the loopback mailbox. Running the whole
 * thing again produces no second notification and no second message.
 *
 * Why the workers are shelled out rather than driven over HTTP: the isolated
 * app runner generates its own cron secret inside the child process and never
 * hands it back, so a browser run cannot authenticate to
 * `/api/cron/csf-publication-notifications`. That is deliberate, and
 * `posts-compose.spec.ts` already takes the same out-of-band route for the mail
 * worker. Both scripts call the real worker functions against the real isolated
 * database; nothing here is mocked.
 *
 * Nothing reaches a real provider. The isolated stack binds the mail transport
 * to loopback Mailpit and the egress guard allows no other port. Every row is
 * fictional, carries this spec's own prefix, and is removed afterwards. The
 * communications ledger is append-only by design, so cleanup cancels the
 * synthetic campaign rather than deleting its attempts or provider events.
 */

const PREFIX = "E2E Personal Notice";

/**
 * Campaign states the ledger treats as settled. A campaign that reached one of
 * these has nothing left to withdraw, and its record is send history.
 */
const TERMINAL_CAMPAIGN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);
const MEMBER = localActors.member;

/** Copy that would claim an outcome the app has not observed. */
const DELIVERY_CLAIMS = /\b(delivered|arrived|received by|inbox)\b/iu;

/**
 * A privileged read of the durable notice queue, through psql on the isolated
 * database rather than PostgREST.
 *
 * plugin_data.csf_publication_events and its deliveries revoke everything from
 * the service role on purpose: the queue decides who hears about a member's
 * record, and nothing outside the database is allowed to browse it. A spec that
 * wanted to see those rows had no business asking as the service role, and the
 * permission denial it got was the ACL working. So the instrumentation asks the
 * owner directly, the way the import preview spec already does.
 *
 * getCsfIsolatedSupabaseEnv refuses a stopped, remote or mismatched stack before
 * any of this runs, and the container is addressed by the validated project id.
 * No credential is passed or printed: psql connects as postgres inside the
 * isolated container.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function assertUuid(value: string, what: string) {
  if (!UUID.test(value)) throw new Error(`Refusing a non-identifier ${what}.`);
  return value;
}

function uuidList(values: string[], what: string) {
  return values.map((value) => `'${assertUuid(value, what)}'`).join(",");
}

function ownerSql() {
  // Strict validation of the selected stack, including its live marker.
  getCsfIsolatedSupabaseEnv();
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  const run = (args: string[], query: string) =>
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${isolated.projectId}`,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
        ...args,
      ],
      { input: query, encoding: "utf8" },
    );
  return {
    exec: (query: string) => {
      run([], query);
    },
    rows: <T>(query: string): T[] => {
      const output = run(
        ["-t", "-A"],
        `SELECT coalesce(json_agg(row_to_json(entry)), '[]'::json) FROM (${query}) AS entry;`,
      );
      return JSON.parse(output.trim() || "[]") as T[];
    },
  };
}

type OwnerSql = ReturnType<typeof ownerSql>;

type MailpitSummary = Record<string, unknown>;

function mailpitOrigin() {
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  return `http://127.0.0.1:${isolated.mailpitPort}`;
}

function mailpitId(message: MailpitSummary) {
  const id = message.ID ?? message.Id ?? message.id;
  return typeof id === "string" ? id : null;
}

function mailpitSubject(message: MailpitSummary) {
  const subject = message.Subject ?? message.subject;
  return typeof subject === "string" ? subject : "";
}

/** The rendered message, which is where a notice says what it is about. */
async function mailpitMessage(id: string) {
  const response = await fetch(
    new URL(`/api/v1/message/${id}`, mailpitOrigin()),
  );
  if (!response.ok) {
    throw new Error(`Mailpit message read failed with ${response.status}.`);
  }
  return (await response.json()) as {
    Subject?: string;
    Text?: string;
    HTML?: string;
  };
}

type NoticeMail = {
  /** The shared headline every point-submission notice carries. */
  subject: string;
  /** This spec's own activity title, minted per run. */
  activityTitle: string;
  /** This spec's own submission, which the action link names. */
  submissionId: string;
};

/**
 * The messages this journey is entitled to count.
 *
 * Every point-submission notice carries the same subject, so matching on it
 * also returns mail other journeys sent to the same fixture student on the same
 * reused mailbox: the failing run counted three, two of them another spec's.
 * Identity comes from the rendered message instead, the activity title this run
 * minted and the deep link to its own submission, read from the body rather
 * than the summary snippet, which Mailpit truncates. Nothing this spec did not
 * send is ever counted, and so nothing else is ever deleted.
 */
async function mailpitMessagesFor(mail: NoticeMail) {
  const search = new URL("/api/v1/search", mailpitOrigin());
  search.searchParams.set("query", mail.activityTitle);
  const response = await fetch(search);
  if (!response.ok) {
    throw new Error(`Mailpit search failed with ${response.status}.`);
  }
  const payload = (await response.json()) as { messages?: MailpitSummary[] };
  const owned: MailpitSummary[] = [];
  for (const message of payload.messages ?? []) {
    const id = mailpitId(message);
    if (!id || mailpitSubject(message) !== mail.subject) continue;
    const body = await mailpitMessage(id);
    const rendered = `${body.Text ?? ""}\n${body.HTML ?? ""}`;
    if (
      rendered.includes(mail.activityTitle) &&
      rendered.includes(mail.submissionId)
    ) {
      owned.push(message);
    }
  }
  return owned;
}

async function deleteMailpitMessages(ids: string[]) {
  if (ids.length === 0) return;
  const response = await fetch(new URL("/api/v1/messages", mailpitOrigin()), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ids }),
  });
  if (!response.ok) {
    throw new Error(`Mailpit cleanup failed with ${response.status}.`);
  }
}

/** One bounded pass of the notice worker, out of band. */
function runNoticeWorker() {
  const output = execFileSync(
    "bun",
    // No react-server condition here, unlike the mail dispatch script below.
    // This worker renders the notice email, and react-dom/server is refused
    // under that condition; the script neutralises `server-only` itself.
    ["run", "scripts/test-csf-publication-notice-worker.ts"],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" },
  );
  const line = output
    .trim()
    .split("\n")
    .findLast((entry) => entry.startsWith("{"));
  if (!line) throw new Error("The notice worker returned no report.");
  return JSON.parse(line) as Record<string, number>;
}

/**
 * Run the notice worker until this spec's own deliveries are settled.
 *
 * The worker drains the whole queue, not one organization's, and it claims at
 * most twenty-five rows per pass. The fixture database is not empty: every
 * seeded post and activity enqueues one delivery per eligible member, and the
 * sixty-odd specs that run before this one add more. A single pass therefore
 * settles twenty-five rows that have nothing to do with this test, which is
 * why asserting on the run's own counters was meaningless here. It described
 * whichever rows it happened to reach.
 *
 * So the queue is drained until the deliveries for these events reach a
 * terminal state, and every assertion afterwards reads those rows rather than
 * a counter. Bounded, so a queue that never settles fails the test instead of
 * running forever.
 */
function drainNoticeWorkerFor(
  sql: OwnerSql,
  organizationId: string,
  eventIds: string[],
  maxPasses = 40,
) {
  const settled = (rows: { status: string }[]) =>
    rows.length > 0 &&
    rows.every((row) => row.status === "delivered" || row.status === "skipped");

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (settled(deliveriesFor(sql, organizationId, eventIds))) break;
    const report = runNoticeWorker();
    // Nothing left to claim anywhere. Another pass cannot change this.
    if (report.claimed === 0) break;
  }
  const rows = deliveriesFor(sql, organizationId, eventIds);
  if (!settled(rows)) {
    throw new Error(
      `The notice queue did not settle this spec's deliveries: ${rows
        .map((row) => row.status)
        .join(", ")}`,
    );
  }
  return rows;
}

/** One bounded pass of the mail worker, out of band. */
function runMailWorker(organizationId: string) {
  const output = execFileSync(
    "bun",
    [
      "--conditions=react-server",
      "run",
      "scripts/test-csf-post-email-dispatch.ts",
      organizationId,
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" },
  );
  const line = output
    .trim()
    .split("\n")
    .findLast((entry) => entry.startsWith("{"));
  if (!line) throw new Error("The mail worker returned no receipt.");
  return JSON.parse(line) as { claimed: number; sent: number; faults: number };
}

async function memberProfile(fixture: CsfFeedFixture) {
  const { data: account, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_profile_accounts")
    .select("profile_id, user_id")
    .eq("organization_id", fixture.organizationId)
    .eq("status", "verified")
    .limit(200);
  if (error)
    throw new Error(`Could not read fixture accounts: ${error.message}`);

  const { data: users, error: usersError } = await fixture.admin
    .schema("public")
    .from("profiles")
    .select("id, email")
    .in(
      "id",
      (account ?? []).map((row) => String(row.user_id)),
    );
  if (usersError)
    throw new Error(`Could not read fixture users: ${usersError.message}`);

  const member = (users ?? []).find(
    (row) => String(row.email).toLowerCase() === MEMBER.email,
  );
  const link = (account ?? []).find(
    (row) => String(row.user_id) === String(member?.id ?? ""),
  );
  if (!member || !link) {
    throw new Error(
      `The fixture member ${MEMBER.email} has no verified CSF profile link.`,
    );
  }
  return {
    userId: String(member.id),
    profileId: String(link.profile_id),
    email: String(member.email).toLowerCase(),
  };
}

/** A fictional activity and a submitted claim against it, for one member. */
async function seedSubmission(
  fixture: CsfFeedFixture,
  profileId: string,
  title: string,
) {
  const { data: activity, error: activityError } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .insert({
      organization_id: fixture.organizationId,
      term_id: fixture.currentTermId,
      title,
      body: "Fictional synthetic activity for the personal notice spec.",
      starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      location: "Fictional Library",
      point_value: 2,
      point_type: "non_drive",
      signup_mode: "none",
      requires_point_submission: true,
      status: "published",
    })
    .select("id")
    .single();
  if (activityError || !activity) {
    throw new Error(
      `Could not seed the fictional activity: ${activityError?.message ?? "no row"}`,
    );
  }

  const { data: submission, error: submissionError } = await fixture.admin
    .schema("plugin_data")
    .from("csf_point_submissions")
    .insert({
      organization_id: fixture.organizationId,
      profile_id: profileId,
      term_id: fixture.currentTermId,
      opportunity_id: activity.id,
      source: "student",
      description: `${title} fictional claim`,
      claimed_points: 2,
      point_type: "non_drive",
      status: "submitted",
    })
    .select("id")
    .single();
  if (submissionError || !submission) {
    throw new Error(
      `Could not seed the fictional submission: ${submissionError?.message ?? "no row"}`,
    );
  }
  return {
    activityId: String(activity.id),
    submissionId: String(submission.id),
  };
}

function noticeEventsFor(
  sql: OwnerSql,
  organizationId: string,
  sourceId: string,
) {
  return sql.rows<{ id: string; source_kind: string; event_key: string }>(
    `SELECT id::text, source_kind, event_key
     FROM plugin_data.csf_publication_events
     WHERE organization_id = '${assertUuid(organizationId, "organization")}'
       AND source_id = '${assertUuid(sourceId, "source")}'`,
  );
}

function deliveriesFor(
  sql: OwnerSql,
  organizationId: string,
  eventIds: string[],
) {
  if (eventIds.length === 0) return [];
  return sql.rows<{ id: string; user_id: string; status: string }>(
    `SELECT id::text, user_id::text, status
     FROM plugin_data.csf_publication_notification_deliveries
     WHERE organization_id = '${assertUuid(organizationId, "organization")}'
       AND event_id IN (${uuidList(eventIds, "event")})`,
  );
}

async function notificationsFor(
  fixture: CsfFeedFixture,
  userId: string,
  eventIds: string[],
) {
  const { data, error } = await fixture.admin
    .schema("public")
    .from("notifications")
    .select("id, title, body, action_url, dedupe_key, type")
    .eq("user_id", userId)
    .in(
      "dedupe_key",
      eventIds.map((id) => `csf-publication:${id}`),
    );
  if (error) throw new Error(`Could not read notifications: ${error.message}`);
  return data ?? [];
}

async function noticeCampaigns(fixture: CsfFeedFixture, eventIds: string[]) {
  if (eventIds.length === 0) return [];
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_communication_campaigns")
    .select("id, status, campaign_kind, source_publication_event_id")
    .eq("organization_id", fixture.organizationId)
    .in("source_publication_event_id", eventIds);
  if (error)
    throw new Error(`Could not read notice campaigns: ${error.message}`);
  return data ?? [];
}

const OFFICER_POINTS_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=points`;

/**
 * Approve the claim through the officer's own review dialog.
 *
 * Driven as a person drives it, not by posting to an action endpoint: a Server
 * Action is not reachable by a plain form post, and the point of an acceptance
 * spec is that the surface an officer actually uses is what produces the
 * notice.
 */
async function approveSubmissionInUi(page: Page, activityTitle: string) {
  await page.goto(OFFICER_POINTS_PATH, { waitUntil: "domcontentloaded" });
  const row = page.getByRole("row").filter({ hasText: activityTitle });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Review .+'s activity$/ });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Approve award", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

test.describe("personal notice lifecycle", () => {
  test("a reviewed submission notifies its own member, links to it, and mails once", async ({
    page,
    browser,
  }, testInfo) => {
    test.slow();
    const failures = watchBrowserFailures(page);
    const fixture = await loadCsfFeedFixture();
    const sql = ownerSql();
    const member = await memberProfile(fixture);
    const title = `${PREFIX} ${testInfo.workerIndex} ${randomUUID().slice(0, 8)}`;
    const seeded = await seedSubmission(fixture, member.profileId, title);

    let mailpitIds: string[] = [];
    let campaignIds: string[] = [];
    let testFailure: Error | null = null;

    try {
      // The officer decision is what the member is entitled to hear about.
      await loginAs(page, "admin");
      await approveSubmissionInUi(page, title);

      await expect
        .poll(async () => {
          const { data } = await fixture.admin
            .schema("plugin_data")
            .from("csf_point_submissions")
            .select("status")
            .eq("organization_id", fixture.organizationId)
            .eq("id", seeded.submissionId)
            .single();
          return data?.status ?? null;
        })
        .toBe("approved");

      // One event, for this submission, and exactly one delivery: the member.
      // The queue is read through the database owner, not the service role: the
      // publication tables revoke everything from it, which is the point.
      const events = noticeEventsFor(
        sql,
        fixture.organizationId,
        seeded.submissionId,
      );
      expect(events).toHaveLength(1);
      expect(events[0].source_kind).toBe("point_submission");
      expect(String(events[0].event_key)).toContain("approved");
      const eventIds = events.map((event) => String(event.id));

      const deliveries = deliveriesFor(sql, fixture.organizationId, eventIds);
      expect(deliveries).toHaveLength(1);
      expect(String(deliveries[0].user_id)).toBe(member.userId);

      // The worker turns it into a notification and hands the mail to the
      // ledger. Drained until this spec's row settles, and then judged on that
      // row rather than on a run counter the rest of the queue also moves.
      const settledRows = drainNoticeWorkerFor(
        sql,
        fixture.organizationId,
        eventIds,
      );
      expect(settledRows).toHaveLength(1);
      expect(settledRows[0].status).toBe("delivered");

      const notices = await notificationsFor(fixture, member.userId, eventIds);
      expect(notices).toHaveLength(1);
      const notice = notices[0];
      expect(String(notice.type)).toBe("organization_updates");
      // The headline names the chapter and the activity, which is the whole
      // point of the change: "New CSF post" told a member nothing.
      expect(String(notice.title)).toContain("updated your point submission");
      expect(String(notice.body)).toContain(title);
      // The member sees the reviewed outcome in this personal notice.
      const rendered = `${notice.title} ${notice.body}`;
      expect(rendered.toLowerCase()).toContain("approved");
      expect(rendered).not.toMatch(DELIVERY_CLAIMS);
      // The button selects this submission, on the tab that renders one.
      const actionUrl = String(notice.action_url);
      expect(actionUrl).toContain("tab=csf-submissions");
      expect(actionUrl).toContain(`csf_submission=${seeded.submissionId}`);

      // What makes a message in the shared mailbox this journey's own.
      const noticeMail = {
        subject: String(notice.title),
        activityTitle: title,
        submissionId: seeded.submissionId,
      };

      const campaigns = await noticeCampaigns(fixture, eventIds);
      expect(campaigns).toHaveLength(1);
      campaignIds = campaigns.map((campaign) => String(campaign.id));
      expect(String(campaigns[0].campaign_kind)).toBe("transactional");

      // Nothing has been sent yet. Queued is not delivered, and until the mail
      // worker runs there is no provider receipt of any kind.
      const { data: beforeSend } = await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_deliveries")
        .select("status")
        .eq("organization_id", fixture.organizationId)
        .in("campaign_id", campaignIds);
      expect((beforeSend ?? []).every((row) => row.status === "queued")).toBe(
        true,
      );
      expect(await mailpitMessagesFor(noticeMail)).toHaveLength(0);

      // Now the mail worker, and the loopback mailbox.
      const dispatch = runMailWorker(fixture.organizationId);
      expect(dispatch.faults).toBe(0);
      expect(dispatch.sent).toBeGreaterThanOrEqual(1);

      await expect
        .poll(async () => {
          const { data } = await fixture.admin
            .schema("plugin_data")
            .from("csf_communication_deliveries")
            .select("status, provider_message_id")
            .eq("organization_id", fixture.organizationId)
            .in("campaign_id", campaignIds);
          return data ?? [];
        })
        .toEqual([{ status: "sent", provider_message_id: expect.any(String) }]);

      const mailbox = await mailpitMessagesFor(noticeMail);
      expect(mailbox).toHaveLength(1);
      mailpitIds = mailbox
        .map(mailpitId)
        .filter((id): id is string => Boolean(id));

      // Retrying the whole chain adds nothing. The notification is dedupe-keyed
      // and the campaign is keyed to the notice, so a replay converges.
      // A real second pass of each worker, not a drain: the drain would see
      // this row already settled and do nothing, which would prove nothing.
      // The delivery is terminal, so the notice worker cannot re-claim it, and
      // the campaign is keyed to the event, so the mail worker finds no new
      // attempt. That is the convergence being asserted below.
      runNoticeWorker();
      runMailWorker(fixture.organizationId);
      expect(
        await notificationsFor(fixture, member.userId, eventIds),
      ).toHaveLength(1);
      expect(await noticeCampaigns(fixture, eventIds)).toHaveLength(1);
      expect(await mailpitMessagesFor(noticeMail)).toHaveLength(1);

      // The member opens the link and lands on their own submission.
      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      const memberFailures = watchBrowserFailures(memberPage);
      try {
        await loginAs(memberPage, "member");
        await memberPage.goto(actionUrl, { waitUntil: "domcontentloaded" });
        await expect(
          memberPage.getByRole("tab", { name: "Point submissions" }),
        ).toHaveAttribute("aria-selected", "true");
        await expect(memberPage.getByText(title).first()).toBeVisible();
        expectNoBrowserFailures(memberFailures);
      } finally {
        await memberContext.close();
      }

      expectNoBrowserFailures(failures);
    } catch (error) {
      testFailure = error instanceof Error ? error : new Error(String(error));
    } finally {
      await cleanUp(fixture, sql, seeded, campaignIds, mailpitIds);
    }
    if (testFailure) throw testFailure;
  });

  test("a member who has turned chapter updates off is never queued", async ({
    page,
  }, testInfo) => {
    const failures = watchBrowserFailures(page);
    const fixture = await loadCsfFeedFixture();
    const sql = ownerSql();
    const member = await memberProfile(fixture);
    const title = `${PREFIX} OptOut ${testInfo.workerIndex} ${randomUUID().slice(0, 8)}`;
    const seeded = await seedSubmission(fixture, member.profileId, title);

    let restoreSettings: (() => Promise<void>) | null = null;
    let testFailure: Error | null = null;

    try {
      const { data: existing } = await fixture.admin
        .schema("public")
        .from("notification_settings")
        .select("user_id, organization_updates")
        .eq("user_id", member.userId)
        .maybeSingle();
      const previous = existing?.organization_updates ?? true;
      const { error: optOutError } = await fixture.admin
        .schema("public")
        .from("notification_settings")
        .upsert(
          { user_id: member.userId, organization_updates: false },
          { onConflict: "user_id" },
        );
      if (optOutError) throw new Error(optOutError.message);
      restoreSettings = async () => {
        await fixture.admin
          .schema("public")
          .from("notification_settings")
          .upsert(
            { user_id: member.userId, organization_updates: previous },
            { onConflict: "user_id" },
          );
      };

      await loginAs(page, "admin");
      await approveSubmissionInUi(page, title);

      await expect
        .poll(
          () =>
            noticeEventsFor(sql, fixture.organizationId, seeded.submissionId)
              .length,
        )
        .toBe(1);
      const eventIds = noticeEventsFor(
        sql,
        fixture.organizationId,
        seeded.submissionId,
      ).map((event) => String(event.id));

      // The row is queued, then refused when the lease re-checks preferences.
      // Suppression happens at authorization, not at enqueue, which is what
      // makes an opt-out recorded after queueing still take effect.
      const settled = drainNoticeWorkerFor(
        sql,
        fixture.organizationId,
        eventIds,
      );
      expect(settled).toHaveLength(1);
      expect(settled[0].status).toBe("skipped");

      // Nothing was written for the member, and nothing was handed to the
      // ledger, which is what "never queued" has to mean.
      expect(await notificationsFor(fixture, member.userId, eventIds)).toEqual(
        [],
      );
      expect(await noticeCampaigns(fixture, eventIds)).toEqual([]);
      expectNoBrowserFailures(failures);
    } catch (error) {
      testFailure = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (restoreSettings) {
        try {
          await restoreSettings();
        } catch {
          // Reported below; the assertion failure is the more useful one.
        }
      }
      await cleanUp(fixture, sql, seeded, [], []);
    }
    if (testFailure) throw testFailure;
  });
});

/**
 * Remove the synthetic rows, and only those.
 *
 * The communications ledger is append-only on purpose: an attempt and its
 * provider event are the record that something was sent, so they are not
 * deleted here. A campaign that already settled is kept for the same reason;
 * one still live is withdrawn through the reviewed cancellation RPC, which is
 * the operator disposition the ledger models. The notice rows this spec created
 * are removed by their own coordinate.
 */
async function cleanUp(
  fixture: CsfFeedFixture,
  sql: OwnerSql,
  seeded: { activityId: string; submissionId: string },
  campaignIds: string[],
  mailpitIds: string[],
) {
  const problems: string[] = [];
  const attempt = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      problems.push(
        `${what}: ${error instanceof Error ? error.message : error}`,
      );
    }
  };

  await attempt("mailpit", () => deleteMailpitMessages(mailpitIds));
  if (campaignIds.length > 0) {
    await attempt("campaign", async () => {
      // Never deleted, and never cancelled by column write. A bare status
      // update is refused by `csf_enforce_campaign_terminalization`, correctly:
      // it would stop the campaign on screen while leaving its queued attempts
      // claimable, with no actor and no reason on the record.
      //
      // A campaign that already reached a terminal state is send history and is
      // retained exactly as its attempts and provider events are. Only one that
      // is still live is withdrawn, through the reviewed RPC, which settles the
      // outstanding work and records this fixture's staff actor and a reason.
      const { data, error } = await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_campaigns")
        .select("id, status")
        .eq("organization_id", fixture.organizationId)
        .in("id", campaignIds);
      if (error) throw new Error(error.message);
      for (const campaign of data ?? []) {
        if (TERMINAL_CAMPAIGN_STATUSES.has(String(campaign.status))) continue;
        const { error: cancelError } = await fixture.admin
          .schema("plugin_data")
          .rpc("csf_cancel_communication_campaign", {
            p_organization_id: fixture.organizationId,
            p_campaign_id: String(campaign.id),
            p_reason: "Personal notice end-to-end fixture cleanup.",
            p_actor_user_id: fixture.organizationAdminUserId,
          });
        if (cancelError) throw new Error(cancelError.message);
      }
    });
  }
  await attempt("notifications", async () => {
    const events = noticeEventsFor(
      sql,
      fixture.organizationId,
      seeded.submissionId,
    );
    if (events.length === 0) return;
    const keys = events
      .map((event) => `'csf-publication:${assertUuid(event.id, "event")}'`)
      .join(",");
    sql.exec(`DELETE FROM public.notifications WHERE dedupe_key IN (${keys});`);
  });

  // The publication event is deliberately left in place.
  //
  // A notice campaign references it with ON DELETE RESTRICT, which is the
  // durable relation between a queued message and the notice that caused it.
  // Deleting the event would either fail, as it did, or would require dropping
  // the campaign first, and the campaign is send history that is not a test's
  // to erase. The event and its settled delivery are queue history; they are
  // harmless to leave, and every later run seeds a new submission and so a new
  // event coordinate.
  await attempt("submission", async () => {
    const { error } = await fixture.admin
      .schema("plugin_data")
      .from("csf_point_submissions")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("id", seeded.submissionId);
    if (error) throw new Error(error.message);
  });
  await attempt("activity", async () => {
    const { error } = await fixture.admin
      .schema("plugin_data")
      .from("csf_opportunities")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("id", seeded.activityId);
    if (error) throw new Error(error.message);
  });

  if (problems.length > 0) {
    console.warn(
      `Personal notice spec cleanup left rows behind: ${problems.join("; ")}`,
    );
  }
}
