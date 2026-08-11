import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  CSF_ISOLATED_APP_PORT,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH } from "./helpers";

/**
 * The real signup-confirmation round trip on the loopback stack, with fictional
 * data and local Mailpit only.
 *
 * `cohort-signup-onboarding.spec.ts` deliberately confirms the synthetic
 * account through the local admin API, so it can never observe the emailed
 * link. That leaves the loopback PKCE seam uncovered: the browser suite opens
 * the app at `http://127.0.0.1:<port>` while the isolated launcher pins
 * `NEXT_PUBLIC_SITE_URL` to `http://localhost:<port>`. Supabase writes the PKCE
 * code verifier on the *request* origin and builds the emailed link from
 * `emailRedirectTo`, so a link mailed for `localhost` cannot be exchanged by a
 * browser holding a `127.0.0.1` verifier -- `exchangeCodeForSession` fails with
 * `pkce_code_verifier_not_found` and `/auth/confirm` diverts to
 * `/auth/email-expired`. `app/signup/request-origin.ts` narrows the emailed
 * origin back to the loopback spelling that stored the verifier; this test is
 * the end-to-end proof, exercised through the same browser context so the
 * verifier cookie is genuinely present.
 *
 * The link carries a single-use credential. It is parsed, asserted on by shape,
 * and navigated to -- never logged, never written to disk, never embedded in an
 * assertion message.
 */

const onboardingCode = "S26-2028";
const connectPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect/${onboardingCode}`;

/** The subject `[auth.email.template.confirmation]` pins in `supabase/config.toml`. */
const confirmationSubject = "Verify your email address";

const runToken = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const signupEmail = `csf.e2e.pkce.${runToken}@local.test`;
const signupPassword = `E2ePkce7${runToken}B`;
const signupFullName = "Robin Pkce Fixture";

/** Marks this suite's seeded profile so cleanup can never touch another one. */
const fixtureMarker = { e2ePkceSignupFixture: true } as const;

type PkceFixture = {
  admin: SupabaseClient;
  organizationId: string;
  cohortId: string;
  retirementTargetProfileId: string;
  /** Persistent fixture actor recorded as the merger during cleanup. */
  developerUserId: string;
  /** Loopback origin of the isolated Mailpit web/API listener. */
  mailpitOrigin: string;
};

/**
 * The Mailpit web API, derived from the same validated isolated bundle the rest
 * of the suite is bound to. `inspectCsfIsolatedWorkDir` revalidates the marker
 * and returns `apiPort = basePort + 1`; the generated config places the Mailpit
 * web interface at `basePort + 4`, which is exactly `apiPort + 3`. Deriving it
 * from the validated API port -- rather than reading an ambient variable --
 * means this test can only ever talk to the stack the runner already proved it
 * owns.
 */
function resolveMailpitOrigin() {
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  const supabaseApiUrl = new URL(getCsfIsolatedSupabaseEnv().url);
  if (Number(supabaseApiUrl.port) !== isolated.apiPort) {
    throw new Error(
      "The isolated Supabase API port disagrees with the validated stack marker.",
    );
  }
  const mailpitPort = isolated.apiPort + 3;
  if (
    !Number.isInteger(mailpitPort) ||
    mailpitPort < 1024 ||
    mailpitPort > 65535
  ) {
    throw new Error(
      `Derived isolated Mailpit port ${mailpitPort} is outside the usable range.`,
    );
  }
  return `http://127.0.0.1:${mailpitPort}`;
}

async function loadPkceFixture(): Promise<PkceFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }

  const plugin = admin.schema("plugin_data");
  const [{ data: cohort, error: cohortError }, retirementResult] =
    await Promise.all([
      plugin
        .from("csf_cohorts")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("graduation_year", 2028)
        .single(),
      plugin
        .from("csf_profiles")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("normalized_school_email", "nina.kapoor28@students.local.test")
        .single(),
    ]);
  if (cohortError || !cohort) {
    throw new Error(
      `Could not load the Class of 2028 fixture: ${cohortError?.message ?? "missing fixture"}`,
    );
  }
  if (retirementResult.error || !retirementResult.data) {
    throw new Error(
      `Could not load the fixture retirement target: ${retirementResult.error?.message ?? "missing fixture"}`,
    );
  }

  const usersResult = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (usersResult.error) {
    throw new Error(
      `Could not load local auth fixtures: ${usersResult.error.message}`,
    );
  }
  const developer = usersResult.data.users.find(
    (candidate) => candidate.email === "platform.admin@local.test",
  );
  if (!developer) {
    throw new Error("The local developer auth fixture is missing.");
  }

  return {
    admin,
    organizationId: organization.id,
    cohortId: cohort.id,
    retirementTargetProfileId: retirementResult.data.id,
    developerUserId: developer.id,
    mailpitOrigin: resolveMailpitOrigin(),
  };
}

async function findUserByEmail(fixture: PkceFixture, email: string) {
  const usersResult = await fixture.admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (usersResult.error) {
    throw new Error(`Could not list local users: ${usersResult.error.message}`);
  }
  return (
    usersResult.data.users.find((candidate) => candidate.email === email) ??
    null
  );
}

async function seedClaimProfile(fixture: PkceFixture) {
  const plugin = fixture.admin.schema("plugin_data");
  const profileId = randomUUID();

  const { error: profileError } = await plugin.from("csf_profiles").insert({
    id: profileId,
    organization_id: fixture.organizationId,
    first_name: "Robin",
    last_name: "Pkce",
    preferred_name: "Robin",
    personal_email: signupEmail,
    normalized_first_name: "robin",
    normalized_last_name: "pkce",
    normalized_personal_email: signupEmail,
    source_summary: fixtureMarker,
  });
  if (profileError) {
    throw new Error(
      `Could not seed the claim profile: ${profileError.message}`,
    );
  }

  const { error: membershipError } = await plugin
    .from("csf_profile_cohort_memberships")
    .insert({
      organization_id: fixture.organizationId,
      profile_id: profileId,
      cohort_id: fixture.cohortId,
      status: "active",
    });
  if (membershipError) {
    throw new Error(
      `Could not seed the cohort membership: ${membershipError.message}`,
    );
  }

  return profileId;
}

/**
 * Same cleanup contract as the existing signup suite: link requests, the
 * organization membership, and any claim account are removed or retired, the
 * seeded profile is de-identified rather than deleted because immutable audit
 * rows reference it, and the synthetic auth user is deleted last (the merger is
 * recorded as the persistent developer fixture, whose `merged_by` FK is
 * ON DELETE RESTRICT).
 */
async function cleanPkceFixture(fixture: PkceFixture, userId: string | null) {
  const plugin = fixture.admin.schema("plugin_data");

  if (userId) {
    const { error: requestsError } = await plugin
      .from("csf_profile_link_requests")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
    if (requestsError) {
      throw new Error(
        `Could not clean claim requests: ${requestsError.message}`,
      );
    }

    const { error: membershipError } = await fixture.admin
      .from("organization_members")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
    if (membershipError) {
      throw new Error(
        `Could not clean the organization membership: ${membershipError.message}`,
      );
    }

    const { error: accountError } = await plugin
      .from("csf_profile_accounts")
      .update({
        status: "revoked",
        is_primary: false,
        revoked_at: new Date().toISOString(),
        notes: "Retired synthetic signup-email PKCE fixture.",
      })
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
    if (accountError) {
      throw new Error(
        `Could not retire claim accounts: ${accountError.message}`,
      );
    }
  }

  const { error: profileError } = await plugin
    .from("csf_profiles")
    .update({
      record_status: "merged",
      merged_into_profile_id: fixture.retirementTargetProfileId,
      merged_at: new Date().toISOString(),
      merged_by: fixture.developerUserId,
      merge_reason: "Retired synthetic signup-email PKCE fixture.",
      personal_email: null,
      normalized_personal_email: null,
    })
    .eq("organization_id", fixture.organizationId)
    .eq("record_status", "active")
    .contains("source_summary", fixtureMarker);
  if (profileError) {
    throw new Error(
      `Could not retire the claim profile: ${profileError.message}`,
    );
  }

  if (userId) {
    const { error: deleteError } =
      await fixture.admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(
        `Could not delete the synthetic signup user: ${deleteError.message}`,
      );
    }
  }
}

type MailpitRecipient = { Address?: string; address?: string };
type MailpitSummary = {
  ID?: string;
  id?: string;
  Subject?: string;
  subject?: string;
  To?: MailpitRecipient[];
  to?: MailpitRecipient[];
};

function mailpitMessageId(message: MailpitSummary) {
  return message.ID ?? message.id;
}

function mailpitSubject(message: MailpitSummary) {
  return message.Subject ?? message.subject;
}

function mailpitRecipients(message: MailpitSummary) {
  return message.To ?? message.to ?? [];
}

function mailpitRecipientAddress(recipient: MailpitRecipient) {
  return recipient.Address ?? recipient.address ?? "";
}

async function readMailpitJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Local Mailpit request failed with ${response.status}.`);
  }
  return response.json();
}

async function deleteMailpitMessages(fixture: PkceFixture, ids: string[]) {
  if (ids.length === 0) return;
  const response = await fetch(`${fixture.mailpitOrigin}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ids }),
  });
  if (!response.ok) {
    throw new Error(
      `Local Mailpit cleanup failed with ${response.status}; no message content was retained.`,
    );
  }
}

/**
 * Every message addressed to exactly this recipient with exactly the pinned
 * confirmation subject. The isolated inbox is shared with the other browser
 * suites, so the recipient is the discriminator; only summaries are read here,
 * never bodies.
 */
async function findConfirmationSummaries(
  fixture: PkceFixture,
  recipient: string,
) {
  const search = new URL("/api/v1/search", fixture.mailpitOrigin);
  search.searchParams.set("query", `to:${recipient}`);
  search.searchParams.set("limit", "20");
  const payload = (await readMailpitJson(search.toString())) as {
    messages?: MailpitSummary[];
  };
  return payload.messages ?? [];
}

/** Attribute values are HTML-escaped by the mailer; only `&` matters here. */
function decodeLinkAmpersands(value: string) {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&#38;/gu, "&")
    .replace(/&#x26;/giu, "&");
}

/**
 * The one Supabase verification link in the message. The returned URL holds a
 * single-use credential, so callers assert on its parsed shape and navigate to
 * it -- nothing here returns, logs, or stores the raw body.
 */
async function readVerificationLink(fixture: PkceFixture, messageId: string) {
  const message = (await readMailpitJson(
    `${fixture.mailpitOrigin}/api/v1/message/${encodeURIComponent(messageId)}`,
  )) as { HTML?: string; Text?: string; html?: string; text?: string };

  const body = `${message.HTML ?? message.html ?? ""}\n${
    message.Text ?? message.text ?? ""
  }`;
  const links = new Set<string>();
  for (const match of body.matchAll(
    /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify\?[^\s"'<>]+/gu,
  )) {
    links.add(decodeLinkAmpersands(match[0]));
  }

  expect(
    links.size,
    "The confirmation email must carry exactly one Supabase verification link",
  ).toBe(1);

  return new URL([...links][0]);
}

/**
 * Pathnames only. The confirmation hop's query string carries the credential,
 * so nothing beyond the path is retained or reported.
 */
function watchNavigationPathnames(page: Page) {
  const visited: string[] = [];
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    try {
      visited.push(new URL(request.url()).pathname);
    } catch {
      // Diagnostic only; an unparsable URL must not affect the page.
    }
  });
  return visited;
}

test.describe("signup email PKCE round trip", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: PkceFixture;
  let createdUserId: string | null = null;
  const createdMessageIds: string[] = [];

  test.beforeAll(async () => {
    fixture = await loadPkceFixture();
  });

  test.afterAll(async () => {
    if (!fixture) return;
    try {
      const user = await findUserByEmail(fixture, signupEmail);
      await cleanPkceFixture(fixture, user?.id ?? createdUserId);
    } finally {
      await deleteMailpitMessages(fixture, createdMessageIds);
    }
  });

  test("normalizes current and legacy Mailpit message summaries", () => {
    const current = {
      id: "current-message",
      subject: confirmationSubject,
      to: [{ address: signupEmail }],
    } satisfies MailpitSummary;
    const legacy = {
      ID: "legacy-message",
      Subject: confirmationSubject,
      To: [{ Address: signupEmail }],
    } satisfies MailpitSummary;

    expect(mailpitMessageId(current)).toBe("current-message");
    expect(mailpitSubject(current)).toBe(confirmationSubject);
    expect(mailpitRecipientAddress(mailpitRecipients(current)[0])).toBe(
      signupEmail,
    );
    expect(mailpitMessageId(legacy)).toBe("legacy-message");
    expect(mailpitSubject(legacy)).toBe(confirmationSubject);
    expect(mailpitRecipientAddress(mailpitRecipients(legacy)[0])).toBe(
      signupEmail,
    );
  });

  test("the emailed confirmation link comes back to the loopback origin that holds the PKCE verifier", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240_000);

    const appOrigin = `http://127.0.0.1:${CSF_ISOLATED_APP_PORT}`;
    // The whole point of this test is the 127.0.0.1 spelling: if the runner
    // ever served the suite from `localhost`, the verifier and the emailed link
    // would agree by accident and the regression would pass vacuously.
    expect(
      new URL(baseURL ?? "").origin,
      "The isolated browser suite must run against the 127.0.0.1 app origin",
    ).toBe(appOrigin);

    const visited = watchNavigationPathnames(page);
    let verificationLink: URL | undefined;

    await test.step("sign up at 127.0.0.1 from the class connect redirect", async () => {
      await page.goto(`/signup?redirect=${encodeURIComponent(connectPath)}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText("Secure check ready", { exact: true }).first(),
      ).toBeVisible();
      // Hydration can briefly leave a duplicate copy of the card in the
      // document; wait for the settled single form, then prove the controlled
      // inputs kept their values before submitting.
      const fullName = page.locator("#fullName");
      const email = page.locator("#email");
      const password = page.locator("#password");
      await expect(fullName).toHaveCount(1, { timeout: 20_000 });
      await fullName.fill(signupFullName);
      await email.fill(signupEmail);
      await password.fill(signupPassword);
      await expect(fullName).toHaveValue(signupFullName);
      await expect(email).toHaveValue(signupEmail);
      await expect(password).toHaveValue(signupPassword);
      const submit = page.getByRole("button", { name: "Create Account" });
      await expect(submit).toBeEnabled();
      await submit.click();
      await page.waitForURL(/\/signup\/success/, {
        waitUntil: "domcontentloaded",
      });

      await expect
        .poll(async () => {
          const user = await findUserByEmail(fixture, signupEmail);
          if (!user) return null;
          createdUserId = user.id;
          return Boolean(user.email_confirmed_at);
        })
        .toBe(false);
    });

    await test.step("local Mailpit holds exactly one confirmation for this recipient", async () => {
      let messageId: string | undefined;
      await expect
        .poll(
          async () => {
            const summaries = await findConfirmationSummaries(
              fixture,
              signupEmail,
            );
            messageId =
              summaries.length === 1
                ? mailpitMessageId(summaries[0])
                : undefined;
            return summaries.length;
          },
          {
            timeout: 60_000,
            intervals: [500, 1_000, 2_000, 5_000],
            message: `Expected one "${confirmationSubject}" message for the synthetic recipient`,
          },
        )
        .toBe(1);
      if (!messageId) {
        throw new Error("The polled confirmation message lost its identifier.");
      }

      createdMessageIds.push(messageId);
      verificationLink = await readVerificationLink(fixture, messageId);
    });

    await test.step("the link returns to the 127.0.0.1 app origin and keeps the connect path", async () => {
      if (!verificationLink) {
        throw new Error("The confirmation link was never extracted.");
      }
      const link = verificationLink;
      const isolated = inspectCsfIsolatedWorkDir(
        process.env.CSF_ISOLATED_WORK_DIR,
      );

      expect(link.origin).toBe(`http://127.0.0.1:${isolated.apiPort}`);
      expect(link.pathname).toBe("/auth/v1/verify");
      expect(link.searchParams.get("type")).toBe("signup");

      const redirectTo = link.searchParams.get("redirect_to");
      expect(
        redirectTo,
        "The confirmation link must carry a redirect_to target",
      ).toBeTruthy();

      // The regression: the mailed target must be the same loopback origin and
      // port that stored the PKCE verifier, not the configured `localhost`
      // spelling, and it must still carry the CSF connect route.
      const confirmTarget = new URL(redirectTo as string);
      expect(confirmTarget.origin).toBe(appOrigin);
      expect(confirmTarget.pathname).toBe("/auth/confirm");
      expect(confirmTarget.searchParams.get("redirectAfterAuth")).toBe(
        connectPath,
      );
    });

    await test.step("the same browser context exchanges the code and verifies the email", async () => {
      if (!verificationLink) {
        throw new Error("The confirmation link was never extracted.");
      }
      // Same page, same context: the verifier cookie written for this origin
      // during signup is what makes the exchange succeed.
      await page.goto(verificationLink.toString(), {
        waitUntil: "domcontentloaded",
      });

      await page.waitForURL(
        (url) => url.pathname === "/auth/verification-success",
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );

      const landed = new URL(page.url());
      expect(landed.origin).toBe(appOrigin);
      expect(landed.searchParams.get("type")).toBe("signup");
      expect(landed.searchParams.get("email")).toBe(signupEmail);
      expect(landed.searchParams.get("redirectAfterAuth")).toBe(connectPath);
      await expect(
        page.getByRole("heading", { name: "Email Verified Successfully!" }),
      ).toBeVisible();

      expect(
        visited,
        "The confirmation must be exchanged on the app origin",
      ).toContain("/auth/confirm");
      expect(
        visited.filter((pathname) => pathname === "/auth/email-expired"),
        "A verifier mismatch would divert the confirmation to /auth/email-expired",
      ).toEqual([]);
      expect(
        visited.filter((pathname) => pathname === "/error"),
        "The confirmation must not fall through to the generic error route",
      ).toEqual([]);

      await expect
        .poll(async () => {
          const user = await findUserByEmail(fixture, signupEmail);
          return Boolean(user?.email_confirmed_at);
        })
        .toBe(true);
    });

    await test.step("the verified account lands on the intended connect route", async () => {
      // `/auth/confirm` signs the session out after the exchange, so the round
      // trip finishes through the page's own CTA, which carries the preserved
      // connect path into login.
      await seedClaimProfile(fixture);

      const loginCta = page.getByRole("link", { name: "Go to Login" });
      await expect(loginCta).toBeVisible();
      await loginCta.click();
      await page.waitForURL((url) => url.pathname === "/login", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      expect(new URL(page.url()).searchParams.get("redirect")).toBe(
        connectPath,
      );

      const main = page.getByRole("main");
      await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
      await expect(
        main.getByText("Secure check ready", { exact: true }),
      ).toBeVisible();
      await main.getByRole("textbox", { name: "Email" }).fill(signupEmail);
      await main.getByLabel("Password").fill(signupPassword);
      await main.getByRole("button", { name: "Login", exact: true }).click();

      // The local stack refuses an unconfirmed sign-in, so reaching the connect
      // route is itself proof that the emailed round trip confirmed the address.
      await page.waitForURL((url) => url.pathname === connectPath, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await expect(
        page.getByRole("heading", {
          name: "We found your CSF record — is this you?",
        }),
      ).toBeVisible();

      expect(
        visited.filter((pathname) => pathname === "/auth/email-expired"),
      ).toEqual([]);
    });
  });
});
