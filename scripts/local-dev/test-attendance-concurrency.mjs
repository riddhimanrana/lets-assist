#!/usr/bin/env node
// Prove lock ordering with real concurrent sessions on an explicitly owned local stack.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  assertLocalPostgresUrl,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "./dv-local-env.mjs";

const stack = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
const local = getCsfIsolatedSupabaseEnv();
const database = new URL(assertLocalPostgresUrl(local.dbUrl));
assert.equal(
  Number(database.port),
  stack.databasePort,
  "database must match the owned stack",
);
for (const supplied of [
  process.env.DATABASE_URL,
  process.env.SUPABASE_DB_URL,
]) {
  if (!supplied) continue;
  const candidate = new URL(assertLocalPostgresUrl(supplied));
  assert.equal(
    candidate.port,
    database.port,
    "database override must match the owned stack",
  );
  assert.equal(
    candidate.pathname,
    database.pathname,
    "database override must name the owned database",
  );
}
const container = `supabase_db_${stack.projectId}`;
if (process.env.ATTENDANCE_TEST_CONTAINER) {
  assert.equal(
    process.env.ATTENDANCE_TEST_CONTAINER,
    container,
    "container override must match the owned stack",
  );
}
const [inspection] = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
);
assert.equal(
  inspection.Config.Labels["com.supabase.cli.project"],
  stack.projectId,
  "database container ownership must match",
);
assert.ok(
  inspection.Mounts.some(
    (mount) => mount.Type === "volume" && mount.Name === stack.databaseVolume,
  ),
  "database volume must match the launcher marker",
);
const args = [
  "exec",
  "-i",
  container,
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-X",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  "VERBOSITY=verbose",
];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const ids = Object.fromEntries(
  [
    "owner",
    "volunteer",
    "staff",
    "org",
    "project",
    "signup",
    "secondProject",
    "secondSignup",
  ].map((key) => [key, randomUUID()]),
);
const runId = randomUUID().replaceAll("-", "");
const sessions = new Set();
const query = (sql) =>
  execFileSync("docker", args, {
    input: sql,
    encoding: "utf8",
    timeout: 10000,
  }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function session(sql, hold = false) {
  const name = `attendance_${randomUUID().replaceAll("-", "")}`;
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, name, output: "", error: "", code: undefined };
  sessions.add(state);
  child.stdout.on("data", (chunk) => {
    state.output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    state.error += chunk;
  });
  state.done = new Promise((resolve) =>
    child.on("close", (code) => {
      state.code = code;
      sessions.delete(state);
      resolve(state);
    }),
  );
  child.stdin.write(
    `SET application_name=${quote(name)}; SET statement_timeout='15s'; BEGIN;\n${sql}\n`,
  );
  if (hold) child.stdin.write("\\echo ATTENDANCE_HOLD_READY\n");
  else child.stdin.end("COMMIT;\n");
  return state;
}

async function until(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function race(firstSql, secondSql, expectedError) {
  const first = session(firstSql, true);
  await until(
    () => first.output.includes("ATTENDANCE_HOLD_READY"),
    `first transaction: ${first.error}`,
  );
  const second = session(secondSql);
  await until(
    () =>
      query(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(second.name)} AND wait_event_type='Lock');`,
      ) === "t",
    `second transaction to block: ${second.error}`,
  );
  first.child.stdin.end("COMMIT;\n");
  await Promise.all([first.done, second.done]);
  assert.equal(first.code, 0, first.error);
  if (expectedError) {
    assert.notEqual(
      second.code,
      0,
      "the stale or unauthorized contender must fail",
    );
    assert.match(second.error, new RegExp(expectedError));
  } else {
    assert.equal(second.code, 0, second.error);
  }
  return second.output;
}

const intervals = (minutes) => [
  {
    checkIn: "2021-08-11T09:00:00Z",
    checkOut: `2021-08-11T${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00Z`,
  },
];
const publicationKey = () =>
  `hours-publication:v1:${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
function publish(project, signup, revision, minutes) {
  const [visit] = intervals(minutes);
  return `SELECT public.publish_volunteer_hours_transactional(${quote(ids.owner)},${quote(project)},'oneTime',${quote(JSON.stringify([{ signupId: signup, ...visit, intervals: [visit], attendanceRevision: revision }]))}::jsonb,${quote(publicationKey())});`;
}
function correct(
  signup,
  revision,
  minutes,
  request = randomUUID(),
  actor = ids.owner,
) {
  return `SELECT public.correct_project_attendance(${quote(signup)},${revision},'Synthetic source review',${quote(JSON.stringify(intervals(minutes)))}::jsonb,${quote(request)},${quote(actor)});`;
}
function awardState(signup) {
  return JSON.parse(
    query(
      `SELECT jsonb_build_object('count',count(*),'id',min(id::text),'minutes',min(credited_minutes),'revision',min(attendance_revision)) FROM public.certificates WHERE signup_id=${quote(signup)} AND type='verified';`,
    ),
  );
}

try {
  query(`BEGIN;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
${["owner", "volunteer", "staff"].map((role) => `(${quote(ids[role])},'authenticated','authenticated',${quote(`attendance-${role}-${runId}@local.test`)},now(),'{}',${quote(JSON.stringify({ username: `att_${role}_${runId.slice(0, 10)}` }))},now(),now())`).join(",")};
INSERT INTO public.organizations(id,name,username,type,join_code,verified) VALUES (${quote(ids.org)},'Attendance race fixture',${quote(`attendance_race_${runId.slice(0, 10)}`)},'nonprofit',${quote(String(100000 + (parseInt(runId.slice(0, 8), 16) % 900000)))},true);
INSERT INTO public.organization_members(organization_id,user_id,role,status) VALUES (${quote(ids.org)},${quote(ids.staff)},'staff','active');
INSERT INTO public.projects(id,creator_id,title,location,description,event_type,verification_method,schedule,status,project_timezone,organization_id,can_be_managed_by_staff) VALUES
${[ids.project, ids.secondProject].map((project) => `(${quote(project)},${quote(ids.owner)},'Attendance race fixture','Local','Synthetic concurrency','oneTime','manual','{"oneTime":{"date":"2021-08-11","startTime":"09:00","endTime":"15:00","volunteers":5}}','upcoming','UTC',${quote(ids.org)},true)`).join(",")};
INSERT INTO public.project_signups(id,project_id,user_id,schedule_id,status) VALUES (${quote(ids.signup)},${quote(ids.project)},${quote(ids.volunteer)},'oneTime','approved'),(${quote(ids.secondSignup)},${quote(ids.secondProject)},${quote(ids.volunteer)},'oneTime','approved');
COMMIT;`);

  await race(
    publish(ids.project, ids.signup, 0, 120),
    correct(ids.signup, 0, 150),
    "40001.*attendance changed; refresh before correcting",
  );
  const original = awardState(ids.signup);
  assert.equal(original.count, 1);
  assert.equal(original.minutes, 120);
  assert.equal(original.revision, 1);
  query(correct(ids.signup, 1, 150));
  assert.equal(awardState(ids.signup).id, original.id);
  console.log(
    "PASS publication wins: blocked stale correction fails; refreshed correction retains certificate",
  );

  const winningRequest = randomUUID();
  const winningCorrection = correct(
    ids.signup,
    2,
    180,
    winningRequest,
    ids.staff,
  );
  await race(
    winningCorrection,
    correct(ids.signup, 2, 210),
    "40001.*attendance changed; refresh before correcting",
  );
  assert.deepEqual(awardState(ids.signup), {
    count: 1,
    id: original.id,
    minutes: 180,
    revision: 3,
  });
  assert.equal(
    query(
      `SELECT count(*) FROM private.project_attendance_changes WHERE signup_id=${quote(ids.signup)};`,
    ),
    "2",
  );
  console.log(
    "PASS competing corrections: one accepted revision, one stale failure, one unchanged certificate ID",
  );

  await race(
    correct(ids.secondSignup, 0, 90),
    publish(ids.secondProject, ids.secondSignup, 0, 120),
    "40001.*attendance changed; refresh before publishing",
  );
  assert.equal(awardState(ids.secondSignup).count, 0);
  query(publish(ids.secondProject, ids.secondSignup, 1, 90));
  const second = awardState(ids.secondSignup);
  assert.equal(second.count, 1);
  assert.equal(second.minutes, 90);
  assert.equal(second.revision, 1);
  console.log(
    "PASS correction wins: stale publication fails without award; refreshed publication uses reviewed minutes",
  );

  await race(
    `DELETE FROM public.organization_members WHERE organization_id=${quote(ids.org)} AND user_id=${quote(ids.staff)};`,
    winningCorrection,
    "42501.*not authorized to correct attendance",
  );
  assert.deepEqual(awardState(ids.signup), {
    count: 1,
    id: original.id,
    minutes: 180,
    revision: 3,
  });
  assert.equal(
    query(
      `SELECT count(*) FROM public.hours_publication_email_outbox outbox JOIN public.certificates cert ON cert.id=outbox.certificate_id WHERE cert.project_id IN (${quote(ids.project)},${quote(ids.secondProject)});`,
    ),
    "2",
  );
  console.log(
    "PASS revoked staff: blocked correction replay rechecks authorization and sends no new email",
  );
  query(
    `UPDATE public.project_signups SET status='attended' WHERE id=${quote(ids.secondSignup)};`,
  );
  const reconciliationBatch = query(
    `SELECT public.create_manual_attendance_batch(${quote(ids.secondProject)},'oneTime',${quote(ids.owner)},${quote(randomUUID())});`,
  );
  const reconciliationRow = query(
    `SELECT public.add_paper_attendance_row(${quote(ids.secondProject)},${quote(reconciliationBatch)},${quote(ids.owner)},${quote(randomUUID())});`,
  );
  const reviewReconciliation = (revision, minutes, match = false) =>
    `SELECT public.update_paper_scan_review_row(${quote(reconciliationBatch)},${quote(ids.secondProject)},${quote(reconciliationRow)},${quote(ids.owner)},${quote(JSON.stringify({ expectedRevision: revision, name: "Synthetic roster volunteer", decision: "include", attendanceIntervals: intervals(minutes), reviewAcknowledged: true, identityConfirmed: true, ...(match ? { matchSignupId: ids.secondSignup } : {}) }))}::jsonb);`;
  const reconcile = (request) =>
    `SELECT outcome || ':' || coalesce(detail,'') FROM public.commit_paper_signup_batch(${quote(reconciliationBatch)},${quote(ids.owner)},ARRAY[${quote(reconciliationRow)}]::uuid[],false,${quote(request)});`;
  query(reviewReconciliation(0, 90));
  assert.equal(query(reconcile(randomUUID())), "roster_only:");
  query(reviewReconciliation(1, 90, true));
  const racedResult = await race(
    correct(ids.secondSignup, 1, 60),
    reconcile(randomUUID()),
  );
  assert.match(racedResult, /failed:duplicate_attendance_requires_correction/);
  assert.deepEqual(awardState(ids.secondSignup), {
    count: 1,
    id: second.id,
    minutes: 60,
    revision: 2,
  });
  assert.equal(
    query(
      `SELECT count(*) FROM public.project_paper_roster_entries WHERE scan_row_id=${quote(reconciliationRow)};`,
    ),
    "1",
  );
  console.log(
    "PASS correction beats reconciliation: blocked request checks current intervals and retains uncovered roster",
  );

  query(reviewReconciliation(2, 30, true));
  const reconciliationRequest = randomUUID();
  const beforeReconciliation = query(
    `SELECT jsonb_build_object('signup',to_jsonb(s),'certificate',to_jsonb(c),'outbox',to_jsonb(o)) FROM public.project_signups s JOIN public.certificates c ON c.signup_id=s.id JOIN public.hours_publication_email_outbox o ON o.certificate_id=c.id WHERE s.id=${quote(ids.secondSignup)};`,
  );
  const replay = await race(
    reconcile(reconciliationRequest),
    reconcile(reconciliationRequest),
  );
  assert.match(replay, /skipped:reconciled_existing_attendance/);
  assert.equal(
    query(
      `SELECT jsonb_build_object('signup',to_jsonb(s),'certificate',to_jsonb(c),'outbox',to_jsonb(o)) FROM public.project_signups s JOIN public.certificates c ON c.signup_id=s.id JOIN public.hours_publication_email_outbox o ON o.certificate_id=c.id WHERE s.id=${quote(ids.secondSignup)};`,
    ),
    beforeReconciliation,
  );
  assert.equal(
    query(
      `SELECT count(*) FROM private.paper_attendance_commit_receipts WHERE request_id=${quote(reconciliationRequest)};`,
    ),
    "1",
  );
  assert.equal(
    query(
      `SELECT results->0->'reconciliation'->'primary_scan_row_id' FROM private.paper_attendance_commit_receipts WHERE request_id=${quote(reconciliationRequest)};`,
    ),
    "null",
  );
  assert.equal(
    query(
      `SELECT count(*) FROM public.project_paper_roster_entries WHERE scan_row_id=${quote(reconciliationRow)};`,
    ),
    "0",
  );
  console.log(
    "PASS simultaneous reconciliation retry: one audited reference, no primary required for Hours attendance, unchanged award and delivery",
  );

  const batchId = query(
    `SELECT public.create_manual_attendance_batch(${quote(ids.project)},'oneTime',${quote(ids.owner)},${quote(randomUUID())});`,
  );
  query(`INSERT INTO public.project_paper_scan_rows(batch_id,project_id,sheet_row_number,raw_extraction)
    SELECT ${quote(batchId)},${quote(ids.project)},row_number,'{}'::jsonb FROM generate_series(1,299) row_number;
    UPDATE public.project_paper_scan_batches SET extracted_row_count=299 WHERE id=${quote(batchId)};`);
  const addRequest = randomUUID();
  const add = (request) =>
    `SELECT public.add_paper_attendance_row(${quote(ids.project)},${quote(batchId)},${quote(ids.owner)},${quote(request)});`;
  await race(
    add(addRequest),
    add(randomUUID()),
    "22023.*batch row limit reached",
  );
  const finalRow = query(add(addRequest));
  assert.equal(
    query(
      `SELECT count(*) FROM public.project_paper_scan_rows WHERE batch_id=${quote(batchId)};`,
    ),
    "300",
  );
  assert.equal(
    query(
      `SELECT sheet_row_number FROM public.project_paper_scan_rows WHERE id=${quote(finalRow)};`,
    ),
    "300",
  );
  assert.equal(
    query(
      `SELECT extracted_row_count FROM public.project_paper_scan_batches WHERE id=${quote(batchId)};`,
    ),
    "300",
  );
  console.log(
    "PASS manual row limit: concurrent additions stop at 300 and successful request replays at the cap",
  );
} finally {
  for (const state of sessions) {
    if (!state.child.stdin.destroyed && !state.child.stdin.writableEnded)
      state.child.stdin.end("ROLLBACK;\n");
  }
  await Promise.all([...sessions].map((state) => state.done));
  query(`BEGIN;
DELETE FROM public.notifications WHERE user_id IN (${quote(ids.owner)},${quote(ids.volunteer)},${quote(ids.staff)});
DELETE FROM public.projects WHERE id IN (${quote(ids.project)},${quote(ids.secondProject)});
DELETE FROM public.organizations WHERE id=${quote(ids.org)};
DELETE FROM auth.users WHERE id IN (${quote(ids.owner)},${quote(ids.volunteer)},${quote(ids.staff)});
COMMIT;`);
}
