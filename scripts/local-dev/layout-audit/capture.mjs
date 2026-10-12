#!/usr/bin/env node
// Standalone read-only synthetic UI capture. No server/DB/provider lifecycle ownership.
import { settleLandingVisual } from "./landing-visual-settlement.mjs";
import {
  verifyNotificationReaderProof,
  notificationReaderFrame,
  notificationTopicCategory,
  notificationFailureReason,
} from "./notification-reader-contract.mjs";
import { readAxeRows } from "./axe-color-diagnostics.mjs";
import fs from "node:fs";
import { requireLiveBinding } from "./linux-binding.mjs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  REPO,
  digest,
  fail,
  routeSafe,
  localRequestSafe,
  exactCompiledBuild,
  proofContracts,
  verifyFixtureRows,
  SHA256,
} from "./capture-contract.mjs";
import {
  sourceIdentity,
  newCaptureOutput,
  validateCaptureNames,
  createExclusiveReceipt,
  appendDurableReceipt,
  readRuntimeBinding,
  bindingShapeGuard,
  verifyLiveRuntime,
} from "./capture-runtime-contract.mjs";
import {
  profileReaderUrl,
  profileReaderFrame,
  profileReaderDiagnostic,
  exactReadActionPolicy,
  readActionRequest,
} from "./capture-effects-contract.mjs";
function ownerFile(p, directory = false) {
  const s = fs.lstatSync(p);
  if (
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077 ||
    !((directory && s.isDirectory()) || (!directory && s.isFile()))
  )
    fail("Owner-only local file/directory required");
  return p;
}
if (process.argv[2] === "--self-test") {
  await import("./guard-tests.mjs");
  process.exit(0);
}
requireLiveBinding();
const manifestPath = process.argv[2];
if (!manifestPath) fail("Supply an owner-only runtime/fixture manifest");
ownerFile(manifestPath);
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (
  m.schema !== "lets-assist-layout-capture-v2" ||
  m.template !== false ||
  m.repoRoot !== REPO ||
  m.syntheticOnly !== true ||
  m.seedMode !== "csf-isolated-v1" ||
  m.serverMode !== "production"
)
  fail("Exact compiled isolated synthetic contract required");
if (
  !/^[a-f0-9]{40}$/u.test(m.rootHead) ||
  !/^[a-f0-9]{40}$/u.test(m.privateHead) ||
  !/^[a-f0-9]{64}$/u.test(m.dirtyDiffSha256)
)
  fail("Exact source identity required");
const source = sourceIdentity();
for (const key of ["rootHead", "privateHead", "dirtyDiffSha256"])
  if (source[key] !== m[key]) fail("Source identity mismatch");
newCaptureOutput(REPO, m.outputDir);
validateCaptureNames(m.captures);
for (const entry of m.captures) {
  if (
    !Array.isArray(entry.expectedRoutes) ||
    !entry.expectedRoutes.length ||
    !Array.isArray(entry.ready) ||
    !entry.ready.length
  )
    fail("Exact routes and reviewed loaded landmarks required");
  routeSafe(entry.route);
  for (const p of entry.expectedRoutes) routeSafe(p);
}
const sourceReview = JSON.parse(
  fs.readFileSync(
    ownerFile(
      new URL("./proof-data/read-action-source-review.json", import.meta.url),
    ),
  ),
);
for (const [file, sha] of Object.entries(
  sourceReview.profileReaderSourceHashes,
)) {
  if (
    !SHA256.test(sha) ||
    digest(fs.readFileSync(path.join(REPO, file))) !== sha
  )
    fail("Reviewed local profile reader source changed");
}
verifyNotificationReaderProof(REPO, sourceReview);
const buildDirectory = exactCompiledBuild(REPO, m);
const approvedActions = exactReadActionPolicy(
  REPO,
  buildDirectory,
  m.readActionPolicy,
);
if (
  !Number.isInteger(m.appPort) ||
  m.appPort < 1024 ||
  m.appPort > 65535 ||
  !Number.isInteger(m.runnerPid) ||
  m.runnerPid < 2
)
  fail("Exact live runtime identity required");
process.env.CSF_ISOLATED_WORK_DIR = m.isolatedWorkDir;
process.env.CSF_ISOLATED_APP_PORT = String(m.appPort);
const dv = await import(
  pathToFileURL(path.join(REPO, "scripts/local-dev/dv-local-env.mjs"))
);
const isolated = dv.inspectCsfIsolatedWorkDir(m.isolatedWorkDir);
const local = dv.getCsfIsolatedSupabaseEnv();
if (
  isolated.projectId !== m.projectId ||
  !m.projectId.startsWith("lets-assist-csf-browser-")
)
  fail("Isolated fixture marker mismatch");
const baseURL = `http://127.0.0.1:${m.appPort}`;
const claim = path.join(
  `/tmp/lets-assist-csf-isolated-claims-${process.getuid()}`,
  `app-port-${m.appPort}`,
  "owner",
);
ownerFile(claim);
const claimed = fs.readFileSync(claim, "utf8");
if (
  !claimed.startsWith(`pid=${m.runnerPid}\n`) ||
  !/^pid=\d+\ntoken=[a-f0-9]{32}\n$/u.test(claimed)
)
  fail("Runner ownership mismatch");
const runtime = readRuntimeBinding(
  m.runtimeBindingFile,
  m.runtimeBindingSha256,
);
const expected = {
  repoRoot: REPO,
  ...source,
  workDir: isolated.workDir,
  runId: isolated.runId,
  projectId: isolated.projectId,
  appPort: m.appPort,
  apiPort: isolated.apiPort,
  databasePort: isolated.databasePort,
  buildId: m.buildId,
  cacheSelectedPaths: [
    ...new Set(m.captures.map((c) => routeSafe(c.route).pathname)),
  ].sort(),
};
bindingShapeGuard(runtime, expected);
if (runtime.runner.pid !== m.runnerPid)
  fail("Claimed runner differs from canonical binding");
for (const [file, sha] of Object.entries(m.buildArtifactHashes))
  if (runtime.compiledFileHashes[file] !== sha)
    fail("Canonical full build receipt differs from the five manifest hashes");
await verifyLiveRuntime(runtime, expected, buildDirectory);
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const admin = createClient(local.url, local.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
if (
  !path.isAbsolute(m.fixtureProofFile ?? "") ||
  !SHA256.test(m.fixtureProofSha256 ?? "")
)
  fail("Exact fixture proof file/hash required");
const proofBytes = fs.readFileSync(ownerFile(m.fixtureProofFile));
if (digest(proofBytes) !== m.fixtureProofSha256)
  fail("Fixture proof hash mismatch");
const fixtureProof = JSON.parse(proofBytes);
const seed = await import(
  pathToFileURL(path.join(REPO, "scripts/local-dev/seed-platform-fixtures.mjs"))
);
const contracts = proofContracts(
  fixtureProof,
  isolated,
  seed.buildSeedFixtureSets(true).seededAccounts,
  digest(
    fs.readFileSync(
      new URL("./retained-identities-proof.sql", import.meta.url),
    ),
  ),
);
const authUsers = [];
for (let page = 1; page <= 10; page++) {
  const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) fail("Auth fixture proof failed");
  const users = result.data?.users ?? [];
  authUsers.push(...users);
  if (authUsers.length > contracts.length) fail("Unknown Auth corpus");
  if (users.length < 1000) break;
  if (page === 10) fail("Auth proof pagination bound exceeded");
}
const profiles = [];
for (let from = 0; from <= contracts.length; from += 1000) {
  const result = await admin
    .from("profiles")
    .select("id,email,username,full_name,avatar_url,phone")
    .order("id")
    .range(from, from + 999);
  if (result.error) fail("Public profile fixture proof failed");
  profiles.push(...result.data);
  if (profiles.length > contracts.length) fail("Unknown public profile corpus");
  if (result.data.length < 1000) break;
}
const corpus = verifyFixtureRows(contracts, authUsers, profiles);
const actorContracts = new Map(
  contracts.filter((a) => a.kind === "baseline").map((a) => [a.key, a]),
);
const creatorProjects = new Map();
if (approvedActions.length) {
  const expectedProjects = [
    { id: seed.IDS.publicProject, creatorKey: "csfAdmin" },
    { id: seed.IDS.orgProject, creatorKey: "developer" },
  ];
  if (
    !Array.isArray(fixtureProof.baselineProjects) ||
    fixtureProof.baselineProjects.length !== expectedProjects.length
  )
    fail("Exact baseline project ownership proof required for read actions");
  const projectRead = await admin
    .from("projects")
    .select("id,creator_id")
    .in(
      "id",
      expectedProjects.map((p) => p.id),
    );
  if (projectRead.error || projectRead.data?.length !== expectedProjects.length)
    fail("Baseline project proof failed");
  for (const p of expectedProjects) {
    const creatorId = actorContracts.get(p.creatorKey)?.id;
    const proof = fixtureProof.baselineProjects.filter(
      (row) => row.id === p.id,
    );
    const actual = projectRead.data.filter((row) => row.id === p.id);
    if (
      proof.length !== 1 ||
      actual.length !== 1 ||
      proof[0].creatorId !== creatorId ||
      actual[0].creator_id !== creatorId
    )
      fail("Baseline project creator proof mismatch");
    creatorProjects.set(p.id, creatorId);
  }
}
const password = fs
  .readFileSync(
    ownerFile(path.join(isolated.workDir, "csf-local-test-password")),
    "utf8",
  )
  .trim();
if (password.length < 16 || /[\r\n]/u.test(password))
  fail("Invalid local fixture password");
const axeSource = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8",
);
if (!Array.isArray(m.captures) || !m.captures.length)
  fail("Explicit capture list required");
const modes = [
  { name: "desktop-light", width: 1440, height: 1000, colorScheme: "light" },
  { name: "desktop-dark", width: 1440, height: 1000, colorScheme: "dark" },
  { name: "phone-light", width: 390, height: 844, colorScheme: "light" },
  { name: "phone-dark", width: 390, height: 844, colorScheme: "dark" },
];
newCaptureOutput(REPO, m.outputDir); // Refuse a concurrent/rerun output change before any write.
const journal = createExclusiveReceipt(
  path.join(m.outputDir, "capture-results.jsonl"),
);
const results = [];
let browser = null,
  finalDriftVerified = false,
  executionFailure = false;
try {
  browser = await chromium.launch({ headless: true });
  for (const entry of m.captures) {
    if (
      !/^[a-z0-9-]{1,90}$/u.test(entry.id) ||
      !Array.isArray(entry.expectedRoutes) ||
      !entry.expectedRoutes.length ||
      !Array.isArray(entry.ready) ||
      !entry.ready.length
    )
      fail("Capture ID and exact allowed final paths required");
    const parsed = routeSafe(entry.route);
    for (const p of entry.expectedRoutes) routeSafe(p);
    const actor = entry.actorKey ? actorContracts.get(entry.actorKey) : null;
    if (entry.actorKey && !actor) fail("Unknown exact seeded actor key");
    for (const mode of [
      ...modes,
      ...(entry.captureReducedMotion === true
        ? [
            {
              name: "desktop-light-reduced",
              width: 1440,
              height: 1000,
              colorScheme: "light",
              reducedMotion: "reduce",
            },
          ]
        : []),
    ]) {
      const context = await browser.newContext({
        baseURL,
        viewport: { width: mode.width, height: mode.height },
        colorScheme: mode.colorScheme,
        reducedMotion: mode.reducedMotion ?? "no-preference",
        locale: "en-US",
        timezoneId: "America/Los_Angeles",
        serviceWorkers: "block",
      });
      let profileAccessToken = null;
      let allowedFrames = 0,
        allowedJoins = 0,
        allowedNotificationJoins = 0,
        allowedReadActions = 0;
      const faults = {
        pageErrors: 0,
        consoleErrors: 0,
        http5xx: 0,
        blockedExternal: 0,
        blockedMutation: 0,
        blockedSocket: 0,
        unsafeNavigation: 0,
      };
      const capture = {
        id: entry.id,
        mode: mode.name,
        role: actor ? "fictional authenticated" : "signed-out",
        status: "incomplete",
        pixelsInspected: false,
        faults,
        socketRefusals: [],
      };
      try {
        await context.addInitScript(
          ({ theme }) => localStorage.setItem("theme", theme),
          { theme: mode.colorScheme },
        );
        await context.route("**/*", async (route) => {
          const req = route.request();
          let u;
          try {
            u = localRequestSafe(req.url(), baseURL, new URL(local.url).origin);
          } catch {
            faults.blockedExternal++;
            await route.abort("blockedbyclient");
            return;
          }
          if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
            try {
              readActionRequest({
                method: req.method(),
                url: req.url(),
                contentType: req.headers()["content-type"],
                actionId: req.headers()["next-action"],
                body: req.postData(),
                actor,
                entry,
                baseURL,
                approvedActions,
                creatorProjects,
              });
              if (++allowedReadActions > 4)
                fail("Read-action request bound exceeded");
            } catch {
              faults.blockedMutation++;
              await route.abort("blockedbyclient");
              return;
            }
          }
          if (req.isNavigationRequest() && u.origin !== baseURL) {
            faults.unsafeNavigation++;
            await route.abort("blockedbyclient");
            return;
          }
          await route.continue();
        });
        await context.routeWebSocket("**/*", (socket) => {
          const connection = {};
          const refuse = (diagnostic) => {
            faults.blockedSocket++;
            if (capture.socketRefusals.length < 4)
              capture.socketRefusals.push(diagnostic);
            socket.close({
              code: 1008,
              reason: "Unreviewed local capture traffic refused",
            });
            connection.server?.close({
              code: 1008,
              reason: "Unreviewed local capture traffic refused",
            });
          };
          try {
            profileReaderUrl(
              socket.url(),
              new URL(local.url).origin,
              local.anonKey,
              actor,
            );
            if (!profileAccessToken) fail("Fresh local actor token absent");
          } catch {
            refuse({
              phase: "endpoint",
              event: "other",
              reason: "url-or-actor-token",
            });
            return;
          }
          socket.onMessage((frame) => {
            let phase = "frame",
              notificationAttempt = false;
            try {
              let kind;
              try {
                kind = profileReaderFrame(frame, actor, profileAccessToken);
              } catch (error) {
                if (
                  notificationTopicCategory(frame, actor) !==
                  "self-notifications"
                )
                  throw error;
                notificationAttempt = true;
                kind = notificationReaderFrame(
                  frame,
                  actor,
                  profileAccessToken,
                );
              }
              phase = "bounds";
              if (
                ++allowedFrames > 512 ||
                (kind === "profile-join" && ++allowedJoins > 8) ||
                (kind === "notification-join" && allowedNotificationJoins >= 1)
              )
                fail("Local profile subscription bound exceeded");
              if (kind === "notification-join") allowedNotificationJoins++;
              phase = "transport";
              connection.server.send(frame);
            } catch (error) {
              const diagnostic =
                phase === "frame"
                  ? profileReaderDiagnostic(frame, actor, profileAccessToken)
                  : {
                      phase,
                      event: "other",
                      reason: phase === "bounds" ? "reader-limit" : "send",
                    };
              diagnostic.topicCategory = notificationTopicCategory(
                frame,
                actor,
              );
              if (phase === "frame" && notificationAttempt)
                diagnostic.reason = notificationFailureReason(error);
              refuse(diagnostic);
            }
          });
          connection.server = socket.connectToServer();
        });
        if (actor) {
          const userResult = await admin.auth.admin.getUserById(actor.id);
          const u = userResult.data?.user;
          if (
            userResult.error ||
            u?.email !== actor.email ||
            u?.user_metadata?.local_fixture !== true
          )
            fail("Fictional actor identity/metadata not verified");
          verifyFixtureRows(
            [actor],
            [u],
            profiles.filter((p) => p.id === actor.id),
          );
          const jar = new Map();
          const auth = createServerClient(local.url, local.anonKey, {
            cookies: {
              getAll: () => [...jar].map(([name, value]) => ({ name, value })),
              setAll: (cs) => {
                for (const c of cs) {
                  if (c.value) jar.set(c.name, c.value);
                  else jar.delete(c.name);
                }
              },
            },
          });
          const signed = await auth.auth.signInWithPassword({
            email: actor.email,
            password,
          });
          if (signed.error || signed.data.user?.id !== actor.id || !jar.size)
            fail("Exact fictional sign-in failed");
          profileAccessToken = signed.data.session?.access_token;
          if (!profileAccessToken)
            fail("Fresh local actor access token absent");
          await context.addCookies(
            [...jar].map(([name, value]) => ({
              name,
              value,
              url: baseURL,
              sameSite: "Lax",
              secure: false,
            })),
          );
          const verify = await auth.auth.getUser();
          if (verify.error || verify.data.user?.id !== actor.id)
            fail("Fresh fictional identity failed");
        }
        const page = await context.newPage();
        page.on("pageerror", () => faults.pageErrors++);
        page.on("console", (msg) => {
          if (msg.type() === "error") faults.consoleErrors++;
        });
        page.on("response", (res) => {
          if (res.status() >= 500) faults.http5xx++;
        });
        const response = await page.goto(parsed.pathname + parsed.search, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        capture.httpStatus = response?.status() ?? null;
        const current = new URL(page.url());
        if (
          current.origin !== baseURL ||
          !entry.expectedRoutes.includes(current.pathname + current.search)
        )
          fail("Unexpected final origin/path/query");
        capture.finalPath = current.pathname;
        if (!response || response.status() < 200 || response.status() >= 300)
          fail("Loaded interior requires a successful page response");
        if (entry.uiSteps) {
          if (!Array.isArray(entry.uiSteps) || entry.uiSteps.length > 4)
            fail("Bounded tab-only inspection required");
          for (const step of entry.uiSteps) {
            if (
              entry.route !== "/dashboard" ||
              Object.keys(step).sort().join(",") !== "name,role" ||
              step.role !== "tab" ||
              !["Overview", "All hours", "Export"].includes(step.name)
            )
              fail("Only an explicit reviewed local tab can be selected");
            await page
              .getByRole("tab", { name: step.name, exact: true })
              .click();
          }
        }
        const after = new URL(page.url());
        if (
          after.origin !== baseURL ||
          !entry.expectedRoutes.includes(after.pathname + after.search)
        )
          fail("Tab changed to an unreviewed route");
        for (const landmark of entry.ready) {
          const scope = landmark.scope ? page.locator(landmark.scope) : page;
          let locator;
          if (landmark.role && typeof landmark.name === "string")
            locator = scope.getByRole(landmark.role, {
              name: landmark.name,
              exact: landmark.exact !== false,
            });
          else if (typeof landmark.text === "string")
            locator = scope.getByText(landmark.text, {
              exact: landmark.exact !== false,
            });
          else if (
            typeof landmark.selector === "string" &&
            landmark.selector !== "main"
          )
            locator = scope.locator(landmark.selector);
          else
            fail(
              "Reviewed loaded landmark required; generic main is insufficient",
            );
          await locator.first().waitFor({ state: "visible", timeout: 12000 });
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
        await page.addScriptTag({ content: axeSource });
        const readAxeResult = () =>
          page.evaluate(readAxeRows, {
            includeColorDetails: entry.id === "landing-baseline" && !actor,
          });
        capture.axe = await readAxeResult();
        capture.axeSamplePhase = "before-keyboard";
        capture.keyboard = [];
        for (let i = 0; i < 16; i++) {
          await page.keyboard.press("Tab");
          capture.keyboard.push(
            await page.evaluate(() => {
              const e = document.activeElement;
              if (!e || e === document.body) return { focusedControl: false };
              const s = getComputedStyle(e);
              const b = e.getBoundingClientRect();
              return {
                focusedControl: true,
                tag: e.tagName.toLowerCase(),
                role: e.getAttribute("role"),
                visible: !!(b.width && b.height),
                inViewport:
                  b.left >= 0 &&
                  b.right <= innerWidth + 1 &&
                  b.top >= 0 &&
                  b.bottom <= innerHeight + 1,
                outlineWidth: s.outlineWidth,
                outlineStyle: s.outlineStyle,
                boxShadowPresent: s.boxShadow !== "none",
              };
            }),
          );
        }
        if (entry.id === "landing-baseline") {
          if (actor)
            fail("Public landing settlement requires signed-out fixture");
          capture.landingSettlement = await settleLandingVisual(
            page,
            entry,
            baseURL,
          );
          if (capture.landingSettlement.status !== "settled")
            fail("Landing layout/assets did not settle within fixed limits");
          capture.axe = await readAxeResult();
          capture.axeSamplePhase = "after-landing-settlement";
        }
        // Sample the rendered state after axe/Tab, immediately before the PNG.
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
        capture.dom = await page.evaluate(() => {
          const visible = (e) =>
            !!(
              e.getClientRects().length &&
              getComputedStyle(e).visibility !== "hidden"
            );
          const loadingMarkers = [
            ...document.querySelectorAll(
              '[aria-busy="true"],[data-slot="skeleton"]',
            ),
          ].filter(visible);
          return {
            samplePhase: "after-keyboard-before-png",
            viewportHeight: document.documentElement.clientHeight,
            documentHeight: document.documentElement.scrollHeight,
            viewportWidth: document.documentElement.clientWidth,
            documentWidth: document.documentElement.scrollWidth,
            horizontalOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
            mainCount: [
              ...document.querySelectorAll('main,[role="main"]'),
            ].filter(visible).length,
            h1Count: [
              ...document.querySelectorAll(
                'h1,[role="heading"][aria-level="1"]',
              ),
            ].filter(visible).length,
            loadingIndicators: loadingMarkers.length,
            loadingMarkerCounts: {
              skeletons: loadingMarkers.filter((e) =>
                e.matches('[data-slot="skeleton"]'),
              ).length,
              ariaBusy: loadingMarkers.filter((e) =>
                e.matches('[aria-busy="true"]'),
              ).length,
              main: loadingMarkers.filter((e) =>
                e.closest('main,[role="main"]'),
              ).length,
              navigation: loadingMarkers.filter((e) =>
                e.closest('nav,[role="navigation"]'),
              ).length,
              outsideMain: loadingMarkers.filter(
                (e) => !e.closest('main,[role="main"]'),
              ).length,
              ariaHidden: loadingMarkers.filter((e) =>
                e.closest('[aria-hidden="true"]'),
              ).length,
              pulseOnly: [
                ...document.querySelectorAll(".animate-pulse"),
              ].filter(
                (e) =>
                  visible(e) &&
                  !e.closest('[aria-busy="true"],[data-slot="skeleton"]'),
              ).length,
            },
            brokenImages: [...document.images].filter(
              (i) => visible(i) && i.complete && i.naturalWidth === 0,
            ).length,
            themeDark: document.documentElement.classList.contains("dark"),
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
          };
        });
        const output = path.join(m.outputDir, `${entry.id}-${mode.name}.png`);
        if (fs.existsSync(output))
          fail("Refusing to overwrite existing capture");
        if (Object.values(faults).some((v) => v !== 0))
          fail(
            "Browser/host/effect guard failed; no successful capture claimed",
          );
        const pixels = await page.screenshot({ fullPage: true, caret: "hide" });
        const png = createExclusiveReceipt(output);
        try {
          fs.writeSync(png, pixels);
          fs.fsyncSync(png);
        } finally {
          fs.closeSync(png);
        }
        capture.image = path.basename(output);
        capture.status = capture.dom.loadingIndicators
          ? "captured-loading-present"
          : "captured-awaiting-pixel-review";
      } catch {
        capture.status = "blocked-or-failed";
        capture.failure =
          "Capture guard/readiness failed; private error/URL omitted";
      } finally {
        capture.readOnlyTraffic = {
          profileJoins: allowedJoins,
          profileFrames: allowedFrames - allowedNotificationJoins,
          notificationJoins: allowedNotificationJoins,
          readerFrames: allowedFrames,
          readActions: allowedReadActions,
        };
        results.push(capture);
        appendDurableReceipt(journal, capture);
        profileAccessToken = null;
        await context.close();
      }
      if (capture.status === "blocked-or-failed")
        fail(
          "Stopped at first incomplete capture; inspect sanitized capture-results.json",
        );
    }
  }
} catch {
  executionFailure = true;
  throw new Error("Capture stopped; inspect exclusive sanitized receipts");
} finally {
  try {
    await browser?.close();
  } catch {
    executionFailure = true;
  }
  try {
    const finalSource = sourceIdentity();
    for (const key of ["rootHead", "privateHead", "dirtyDiffSha256"])
      if (finalSource[key] !== m[key]) fail("Final source drift");
    exactCompiledBuild(REPO, m);
    await verifyLiveRuntime(runtime, expected, buildDirectory);
    finalDriftVerified = true;
  } catch {
    executionFailure = true;
  }
  try {
    const final = createExclusiveReceipt(
      path.join(m.outputDir, "capture-results.json"),
    );
    try {
      appendDurableReceipt(final, {
        schema: m.schema,
        projectId: m.projectId,
        rootHead: m.rootHead,
        privateHead: m.privateHead,
        dirtyDiffSha256: m.dirtyDiffSha256,
        buildId: m.buildId,
        buildDistDir: m.buildDistDir,
        buildArtifactHashes: m.buildArtifactHashes,
        runtimeBindingSha256: m.runtimeBindingSha256,
        fixtureProofSha256: m.fixtureProofSha256,
        fixtureCorpus: corpus,
        completeVisualAudit: false,
        pixelsInspected: 0,
        finalDriftVerified,
        executionFailure,
        results,
      });
    } finally {
      fs.closeSync(final);
    }
  } finally {
    fs.closeSync(journal);
  }
}
if (executionFailure || !finalDriftVerified)
  fail(
    "Runtime/source/build verification failed; no completed capture batch claimed",
  );
process.stdout.write(
  JSON.stringify({
    captures: results.length,
    pixelsInspected: 0,
    completeVisualAudit: false,
    outputDir: m.outputDir,
    buildDistDir: m.buildDistDir,
    fixtureCorpus: corpus,
  }) + "\n",
);
