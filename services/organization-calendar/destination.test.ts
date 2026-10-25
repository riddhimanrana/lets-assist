import { afterAll, beforeEach, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let row: {
  state: string | null;
  calendar_id: string | null;
  operation_id: string | null;
  legacy_id: string | null;
};
let proof: "owned" | "missing" | "unconfirmed";
let failClaim: boolean;
let failFinish: boolean;
const rpc = mock(async (name: string, args: Record<string, unknown>) => {
  if (name === "complete_organization_calendar_destination") {
    if (failFinish) return { data: null, error: {} };
    row.state = String(args.p_outcome);
    row.calendar_id = args.p_calendar_id as string | null;
    return { data: { ...row }, error: null };
  }
  if (failClaim) return { data: null, error: {} };
  if (args.p_verified_calendar_id)
    row = {
      ...row,
      state: "ready",
      calendar_id: String(args.p_verified_calendar_id),
    };
  const create =
    args.p_allow_create === true &&
    [null, "ready", "rejected"].includes(row.state);
  if (create)
    row = {
      ...row,
      state: "provisioning",
      calendar_id: null,
      operation_id: "ab000000-0000-4000-8000-000000000001",
    };
  return { data: { ...row, should_create: create }, error: null };
});
const ownership = mock(async (_token: string, _id: string) => proof);
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc }),
}));
mock.module("@/services/personal-calendar/destination", () => ({
  verifyOwnedLegacyCalendar: ownership,
}));
const { ensureDurableOrganizationCalendar } = await import("./destination");
const options = {
  userId: "actor",
  organizationId: "org",
  accessToken: "fictional",
  calendarName: "Fictional organization",
};
beforeEach(() => {
  row = { state: null, calendar_id: null, operation_id: null, legacy_id: null };
  proof = "owned";
  failClaim = false;
  failFinish = false;
  rpc.mockClear();
  ownership.mockClear();
});
afterAll(() => mock.restore());
test("reserves before provider creation and saves the calendar before success", async () => {
  const fetcher = mock(async (_url: unknown, init?: RequestInit) => {
    expect(row.state).toBe("provisioning");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
    return Response.json({ id: "created@example.test" });
  });
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toEqual({ calendarId: "created@example.test", created: true });
  expect(row.state).toBe("ready");
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toEqual({ calendarId: "created@example.test", created: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test.each([408, 429, 500, 503])(
  "ambiguous HTTP%d blocks a second creation",
  async (status) => {
    const fetcher = mock(async () => new Response(null, { status }));
    expect(
      await ensureDurableOrganizationCalendar(
        options,
        fetcher as unknown as typeof fetch,
      ),
    ).toBeNull();
    expect(row.state).toBe("unknown_outcome");
    expect(
      await ensureDurableOrganizationCalendar(
        options,
        fetcher as unknown as typeof fetch,
      ),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
test("lost completion persists the claim and never recreates on retry", async () => {
  failFinish = true;
  const fetcher = mock(async () =>
    Response.json({ id: "created@example.test" }),
  );
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBeNull();
  expect(row.state).toBe("provisioning");
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("claim failure prevents provider writes", async () => {
  failClaim = true;
  const fetcher = mock(async () =>
    Response.json({ id: "created@example.test" }),
  );
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
test("verified legacy identity is adopted with compare-and-swap", async () => {
  row.legacy_id = "legacy@example.test";
  const fetcher = mock(async () => Response.json({}));
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toEqual({ calendarId: "legacy@example.test", created: false });
  expect(rpc.mock.calls.at(-1)?.[1].p_verified_calendar_id).toBe(
    "legacy@example.test",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
test("canonical identity wins over a changed compatibility config", async () => {
  row = {
    ...row,
    state: "ready",
    calendar_id: "canonical@example.test",
    legacy_id: "changed@example.test",
  };
  expect(await ensureDurableOrganizationCalendar(options)).toEqual({
    calendarId: "canonical@example.test",
    created: false,
  });
  expect(ownership.mock.calls[0][1]).toBe("canonical@example.test");
});
test("uncertain ownership cannot adopt or replace", async () => {
  row.legacy_id = "legacy@example.test";
  proof = "unconfirmed";
  const fetcher = mock(async () => Response.json({}));
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBeNull();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
});
test("confirmed missing destination passes the precise prior identity to claim", async () => {
  row.legacy_id = "missing@example.test";
  proof = "missing";
  const fetcher = mock(async () => Response.json({ id: "new@example.test" }));
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toEqual({ calendarId: "new@example.test", created: true });
  expect(rpc.mock.calls[1][1].p_replace_calendar_id).toBe(
    "missing@example.test",
  );
});
test.each([{}, { id: "primary" }, { id: "../escape" }])(
  "malformed successful response remains uncertain: %j",
  async (payload) => {
    const fetcher = mock(async () => Response.json(payload));
    expect(
      await ensureDurableOrganizationCalendar(
        options,
        fetcher as unknown as typeof fetch,
      ),
    ).toBeNull();
    expect(row.state).toBe("unknown_outcome");
  },
);

test("a confirmed rejected creation can retry after credentials are repaired", async () => {
  const fetcher = mock(async () => new Response(null, { status: 403 }));
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toBeNull();
  expect(row.state).toBe("rejected");
  fetcher.mockResolvedValue(Response.json({ id: "repaired@example.test" }));
  expect(
    await ensureDurableOrganizationCalendar(
      options,
      fetcher as unknown as typeof fetch,
    ),
  ).toEqual({ calendarId: "repaired@example.test", created: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
