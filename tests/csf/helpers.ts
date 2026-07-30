import { expect, type Page, type Response } from "@playwright/test";

export const CSF_ORGANIZATION_SLUG = "dvhs-csf";
export const CSF_ORGANIZATION_PATH = `/organization/${CSF_ORGANIZATION_SLUG}`;
export const CSF_PUBLIC_PATH = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/public`;

export const localActors = {
  admin: {
    email: "csf.admin@local.test",
    name: "CSF Admin Fixture",
  },
  activityCoordinator: {
    email: "csf.officer@local.test",
    name: "CSF Officer",
  },
  adviser: {
    email: "csf.adviser@local.test",
    name: "Adviser Fixture",
  },
  coPresident: {
    email: "csf.co-president-one@local.test",
    name: "Co-President One Fixture",
  },
  vpMembership: {
    email: "csf.vp-membership@local.test",
    name: "VP Membership Fixture",
  },
  vpPublicity: {
    email: "csf.vp-publicity@local.test",
    name: "VP Publicity Fixture",
  },
  vpClubs: {
    email: "csf.vp-clubs@local.test",
    name: "VP Clubs Fixture",
  },
  treasurer: {
    email: "csf.treasurer@local.test",
    name: "Treasurer Fixture",
  },
  secretary: {
    email: "csf.secretary@local.test",
    name: "Secretary Fixture",
  },
  webMaster: {
    email: "csf.web-master@local.test",
    name: "Web Master Fixture",
  },
  dataManagement: {
    email: "csf.data-management@local.test",
    name: "Data Management Fixture",
  },
  applicant: {
    email: "csf.applicant@local.test",
    name: "Evan Chen Fixture",
  },
  member: {
    email: "student.2028@local.test",
    name: "Aarav Mehta",
  },
  outsider: {
    email: "platform.outsider@local.test",
    name: "Platform Outsider",
  },
} as const;

export type LocalActor = keyof typeof localActors;

export function localTestPassword() {
  const password =
    process.env.CSF_LOCAL_TEST_PASSWORD ?? process.env.DV_LOCAL_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      "Set CSF_LOCAL_TEST_PASSWORD (or DV_LOCAL_TEST_PASSWORD) to the local fixture password.",
    );
  }
  return password;
}

export async function loginAs(
  page: Page,
  actor: LocalActor,
  redirectPath = CSF_ORGANIZATION_PATH,
) {
  const account = localActors[actor];
  await page.goto(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  const main = page.getByRole("main");
  // The server-rendered form is inert until the client has hydrated. Wait for
  // the form's explicit readiness marker before interacting with controlled
  // inputs so a fast production render cannot reset early values.
  await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
  await expect(main.getByText("Secure check ready", { exact: true })).toBeVisible();
  const email = main.getByRole("textbox", { name: "Email" });
  const password = main.getByLabel("Password");
  await email.fill(account.email);
  await password.fill(localTestPassword());
  await expect(email).toHaveValue(account.email);
  const expectedUrl = new URL(redirectPath, page.url());
  await main.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL((url) => (
    url.pathname === expectedUrl.pathname && url.search === expectedUrl.search
  ), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
}

export function watchBrowserFailures(page: Page) {
  const failures: string[] = [];
  let projectFeedState = "not-requested";

  page.on("request", (request) => {
    try {
      if (new URL(request.url()).pathname === "/api/projects") {
        projectFeedState = `pending ${request.method()} /api/projects`;
      }
    } catch {
      // Playwright request URLs are normally absolute. An unparsable diagnostic
      // value must not affect the page under test.
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const diagnostic = message
        .text()
        .includes("Error loading project feed:")
        ? ` [page=${new URL(page.url()).pathname} project-feed=${projectFeedState}]`
        : "";
      failures.push(`console: ${message.text()}${diagnostic}`);
    }
  });
  page.on("response", (response) => {
    try {
      if (new URL(response.url()).pathname === "/api/projects") {
        projectFeedState = `response ${response.status()} ${response.request().method()} /api/projects`;
      }
    } catch {
      // Diagnostic only.
    }
    if (response.status() >= 500) {
      failures.push(
        `response: ${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    const url = request.url();
    try {
      if (new URL(url).pathname === "/api/projects") {
        projectFeedState = `failed ${request.method()} /api/projects ${failure?.errorText ?? "unknown"}`;
      }
    } catch {
      // Diagnostic only.
    }
    if (url.includes("/_next/webpack-hmr") || url.endsWith("/favicon.ico"))
      return;
    if (failure?.errorText === "net::ERR_ABORTED") return;
    failures.push(
      `requestfailed: ${request.method()} ${url} ${failure?.errorText ?? ""}`,
    );
  });
  return failures;
}

export function expectNoBrowserFailures(failures: string[]) {
  expect(failures, failures.join("\n")).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
}

export async function responseText(response: Response | null) {
  expect(response, "Expected a document response").not.toBeNull();
  return response!.text();
}

export const PRIVATE_PUBLIC_BOUNDARY_MARKERS = [
  "Aarav Mehta",
  "Maya Patel",
  "Priya Shah",
  "Evan Chen",
  "Nina Kapoor",
  "Sofia Nguyen",
  "@students.local.test",
  "@local.test",
  "csf_term_applications",
  "csf_profiles",
  "csf_meeting_attendance",
  "csf_admin_audit_events",
  "dues_status",
  "eligibility_status",
  "decision_reason",
] as const;

export function expectNoPrivateBoundaryMarkers(value: string) {
  for (const marker of PRIVATE_PUBLIC_BOUNDARY_MARKERS) {
    expect(
      value,
      `Public response exposed private marker: ${marker}`,
    ).not.toContain(marker);
  }
}
