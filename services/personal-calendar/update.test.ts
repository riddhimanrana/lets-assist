import { describe, expect, test } from "bun:test";
import type { Project } from "@/types";
import {
  CalendarSyncError,
  reconcilePersonalCalendar,
  type CalendarReceiptStep,
  type PersonalCalendarEvent,
  type PersonalCalendarReceipt,
} from "./reconcile";
import {
  personalCalendarProjectSource,
  reconcilePersonalCalendarUpdate,
} from "./update";

const GENERATION = "30000000-0000-4000-8000-000000000001";
const CONNECTION = "50000000-0000-4000-8000-000000000001";
const marker = { private: { letsAssistReceipt: GENERATION } };
const shift = (summary: string): PersonalCalendarEvent => ({
  summary,
  start: { dateTime: "2026-10-10T10:00:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-10-10T11:00:00", timeZone: "America/Los_Angeles" },
});

function fixture(overrides: Partial<PersonalCalendarReceipt> = {}) {
  let saved: PersonalCalendarReceipt = {
    source_kind: "project",
    source_id: "10000000-0000-4000-8000-000000000001",
    user_id: "20000000-0000-4000-8000-000000000001",
    project_id: "10000000-0000-4000-8000-000000000001",
    generation: GENERATION,
    phase: "updating",
    requested_schedule_id: null,
    legacy_event_id: null,
    calendar_id: "owned@example.test",
    events: [
      {
        id: "laevent00001",
        event: { ...shift("Old first"), extendedProperties: marker },
      },
      {
        id: "laevent00002",
        event: { ...shift("Old second"), extendedProperties: marker },
      },
    ],
    confirmed_event_ids: [],
    claim_token: "40000000-0000-4000-8000-000000000001",
    update_planned_at: null,
    update_connection_id: null,
    ...overrides,
  };
  const provider = new Map<string, PersonalCalendarEvent>(
    saved.events.map(({ id, event }) => [id, event as PersonalCalendarEvent]),
  );
  const calls: string[] = [];
  let activeConnection: string | null = CONNECTION;
  let failStep: CalendarReceiptStep | undefined;
  let failSkip = 0;
  let onLookup: () => void = () => undefined;
  let failProviderId: string | undefined;
  let desired = [shift("New first"), shift("New second")];
  const dependencies = {
    async advance(
      _receipt: PersonalCalendarReceipt,
      step: CalendarReceiptStep,
      payload: Record<string, unknown> = {},
    ) {
      calls.push(step);
      if (failStep === step && failSkip-- <= 0) {
        failStep = undefined;
        throw new Error("database unavailable");
      }
      if (step === "plan") {
        saved.calendar_id = payload.calendar_id as string;
        saved.events = structuredClone(
          payload.events,
        ) as PersonalCalendarReceipt["events"];
        saved.update_planned_at = "2026-10-11T00:00:00Z";
        saved.update_connection_id = payload.connection_id as string;
        saved.confirmed_event_ids = [];
      }
      if (step === "confirm")
        saved.confirmed_event_ids.push(payload.event_id as string);
      if (step === "finish") {
        saved.phase = "synced";
        saved.update_planned_at = null;
      }
      return structuredClone(saved);
    },
    events(receipt: PersonalCalendarReceipt) {
      calls.push(`events:${receipt.requested_schedule_id}`);
      return desired;
    },
    async legacyDestination() {
      calls.push("legacyDestination");
      return "legacy@example.test" as string | null;
    },
    async authorize() {
      calls.push("authorize");
      if (!activeConnection)
        throw new CalendarSyncError("Google Calendar disconnected", 409);
      return activeConnection;
    },
    async update(
      calendarId: string,
      id: string,
      event: PersonalCalendarEvent,
      legacy: boolean,
      beforeWrite: () => Promise<void>,
    ) {
      // Like the real updater: look up first, then check authority, then
      // write. A refused check means no write and an unconfirmed result.
      calls.push(`lookup:${id}`);
      onLookup();
      try {
        await beforeWrite();
      } catch {
        return false;
      }
      calls.push(`update:${id}:${calendarId}:${legacy}`);
      if (id === failProviderId) return false;
      provider.set(id, event);
      return true;
    },
  };
  return {
    get receipt() {
      return structuredClone(saved);
    },
    set receipt(value: PersonalCalendarReceipt) {
      saved = structuredClone(value);
    },
    setDesired(value: PersonalCalendarEvent[]) {
      desired = value;
    },
    setConnection(value: string | null) {
      activeConnection = value;
    },
    /** Fail the given step once, after letting `skip` earlier calls through. */
    failStep(step: CalendarReceiptStep, skip = 0) {
      failStep = step;
      failSkip = skip;
    },
    onLookup(hook: () => void) {
      onLookup = hook;
    },
    failProvider(id?: string) {
      failProviderId = id;
    },
    calls,
    provider,
    dependencies,
  };
}

describe("in-place personal calendar update", () => {
  test("rewrites every saved ID on its original calendar and generation", async () => {
    const f = fixture();
    const before = f.receipt;
    const result = await reconcilePersonalCalendarUpdate(
      before,
      f.dependencies,
    );
    expect(result).toEqual({ eventId: "laevent00001", phase: "synced" });
    expect(f.receipt.events.map(({ id }) => id)).toEqual([
      "laevent00001",
      "laevent00002",
    ]);
    expect(f.receipt.calendar_id).toBe("owned@example.test");
    expect(f.receipt.generation).toBe(before.generation);
    expect([...f.provider.keys()]).toEqual(["laevent00001", "laevent00002"]);
    expect(f.provider.get("laevent00001")).toMatchObject({
      summary: "New first",
      extendedProperties: marker,
    });
    expect(f.provider.get("laevent00002")?.summary).toBe("New second");
    expect(f.calls.indexOf("plan")).toBeLessThan(
      f.calls.findIndex((call) => call.startsWith("update:")),
    );
    expect(f.calls).not.toContain("legacyDestination");
  });

  test("a partial failure retries only the remaining event from the frozen plan", async () => {
    const f = fixture();
    f.failProvider("laevent00002");
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toThrow("Calendar outcome is unconfirmed");
    expect(f.receipt.phase).toBe("updating");
    expect(f.receipt.confirmed_event_ids).toEqual(["laevent00001"]);
    expect(f.calls.at(-1)).toBe("release");
    expect(f.calls).not.toContain("finish");

    f.failProvider();
    f.dependencies.events = () => {
      throw new Error("must use the frozen plan");
    };
    await reconcilePersonalCalendarUpdate(f.receipt, f.dependencies);
    expect(f.calls.filter((call) => call === "plan")).toHaveLength(1);
    expect(
      f.calls.filter((call) => call.startsWith("update:laevent00001")),
    ).toHaveLength(1);
    expect(f.provider.get("laevent00002")?.summary).toBe("New second");
    expect(f.receipt.phase).toBe("synced");
  });

  test("a lost confirmation replays the same ID and payload", async () => {
    const f = fixture();
    f.failStep("confirm");
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toThrow("database unavailable");
    expect(f.receipt.confirmed_event_ids).toEqual([]);
    await reconcilePersonalCalendarUpdate(f.receipt, f.dependencies);
    const first = f.calls.filter((call) =>
      call.startsWith("update:laevent00001"),
    );
    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(1);
    expect(f.provider.size).toBe(2);
  });

  test("a changed occurrence count refuses before any plan or provider write", async () => {
    for (const desired of [
      [shift("Only one")],
      [shift("One"), shift("Two"), shift("Three")],
      [],
    ]) {
      const f = fixture();
      f.setDesired(desired);
      await expect(
        reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("number of calendar occurrences"),
      });
      expect(f.calls).not.toContain("plan");
      expect(f.calls.some((call) => call.startsWith("update:"))).toBe(false);
      expect(f.provider.get("laevent00001")?.summary).toBe("Old first");
      expect(f.calls.at(-1)).toBe("release");
    }
  });

  test("the persisted schedule selection chooses what is rewritten", async () => {
    const f = fixture({
      requested_schedule_id: "2026-10-10-0-1",
      events: [{ id: "laevent00001", event: shift("Old slot") }],
    });
    f.setDesired([shift("New slot")]);
    await reconcilePersonalCalendarUpdate(f.receipt, f.dependencies);
    expect(f.calls).toContain("events:2026-10-10-0-1");
  });

  test("a legacy marker updates only its known ID on the stored destination", async () => {
    const f = fixture({
      legacy_event_id: "legacyevent123",
      calendar_id: null,
      events: [],
    });
    f.setDesired([shift("Legacy refreshed")]);
    await reconcilePersonalCalendarUpdate(f.receipt, f.dependencies);
    expect(f.calls).toContain("legacyDestination");
    expect(f.calls).toContain("update:legacyevent123:legacy@example.test:true");
    expect(f.receipt.events.map(({ id }) => id)).toEqual(["legacyevent123"]);
    expect([...f.provider.keys()]).toEqual(["legacyevent123"]);
  });

  test("a legacy marker with no stored or only a primary destination writes nothing", async () => {
    for (const destination of [null, "primary"]) {
      const f = fixture({
        legacy_event_id: "legacyevent123",
        calendar_id: null,
        events: [],
      });
      f.setDesired([shift("Legacy refreshed")]);
      f.dependencies.legacyDestination = async () => destination;
      await expect(
        reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.calls).not.toContain("plan");
      expect(f.provider.size).toBe(0);
    }
  });

  test("a modern receipt never marks its events as legacy", async () => {
    const f = fixture();
    await reconcilePersonalCalendarUpdate(f.receipt, f.dependencies);
    expect(f.calls.filter((call) => call.startsWith("update:"))).toEqual([
      "update:laevent00001:owned@example.test:false",
      "update:laevent00002:owned@example.test:false",
    ]);
  });

  test("a disconnect before the first write issues no provider mutation", async () => {
    const f = fixture();
    f.setConnection(null);
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.calls.some((call) => call.startsWith("update:"))).toBe(false);
    expect(f.calls).not.toContain("finish");
  });

  test("a disconnect after the last write is never acknowledged as success", async () => {
    const f = fixture();
    const update = f.dependencies.update;
    f.dependencies.update = async (calendarId, id, event, legacy, check) => {
      const confirmed = await update(calendarId, id, event, legacy, check);
      if (id === "laevent00002") f.setConnection(null);
      return confirmed;
    };
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toMatchObject({ status: 409 });
    // The write landed, but it is neither confirmed nor finished under a lost connection.
    expect(f.provider.get("laevent00002")?.summary).toBe("New second");
    expect(f.receipt.confirmed_event_ids).toEqual(["laevent00001"]);
    expect(f.calls).not.toContain("finish");
    expect(f.receipt.phase).toBe("updating");
  });

  test("lease, source and connection are rechecked between the lookup and the write", async () => {
    const f = fixture({
      events: [{ id: "laevent00001", event: shift("Old only") }],
    });
    f.setDesired([shift("New only")]);
    await reconcilePersonalCalendarUpdate(f.receipt, f.dependencies);
    const lookup = f.calls.indexOf("lookup:laevent00001");
    const write = f.calls.findIndex((call) => call.startsWith("update:"));
    expect(f.calls.slice(lookup + 1, write)).toEqual(["renew", "authorize"]);
    // And the connection is checked again after the write, before each acknowledgement.
    expect(f.calls.slice(write + 1)).toEqual([
      "authorize",
      "confirm",
      "authorize",
      "finish",
    ]);
  });

  test("a source that changes during the provider lookup stops before the write", async () => {
    const f = fixture();
    // The first renew (before the lookup) passes; the one before the write fails.
    f.failStep("renew", 1);
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toThrow("database unavailable");
    expect(f.calls).toContain("lookup:laevent00001");
    expect(f.calls.some((call) => call.startsWith("update:"))).toBe(false);
    expect(f.provider.get("laevent00001")?.summary).toBe("Old first");
    expect(f.calls).not.toContain("confirm");
    expect(f.calls.at(-1)).toBe("release");
  });

  test.each([null, "50000000-0000-4000-8000-000000000002"])(
    "a connection that becomes %s during the provider lookup stops before the write",
    async (connection) => {
      const f = fixture();
      f.onLookup(() => f.setConnection(connection));
      await expect(
        reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.calls.some((call) => call.startsWith("update:"))).toBe(false);
      expect(f.provider.get("laevent00001")?.summary).toBe("Old first");
      expect(f.calls).not.toContain("confirm");
      expect(f.calls).not.toContain("finish");
    },
  );

  test("a rebound connection cannot finish a plan pinned to another connection", async () => {
    const f = fixture();
    f.failProvider("laevent00002");
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toThrow();
    f.failProvider();
    f.setConnection("50000000-0000-4000-8000-000000000002");
    const writes = f.calls.filter((call) => call.startsWith("update:")).length;
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("connection changed"),
    });
    expect(f.calls.filter((call) => call.startsWith("update:"))).toHaveLength(
      writes,
    );
    expect(f.calls).not.toContain("finish");
  });

  test("plan persistence or renewal failure issues no provider mutation", async () => {
    for (const step of ["plan", "renew"] as const) {
      const f = fixture();
      f.failStep(step);
      await expect(
        reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
      ).rejects.toThrow("database unavailable");
      expect(f.calls.some((call) => call.startsWith("update:"))).toBe(false);
    }
  });

  test("bounded request duration saves progress for another request", async () => {
    const f = fixture();
    let now = 0;
    await expect(
      reconcilePersonalCalendarUpdate(f.receipt, {
        ...f.dependencies,
        now: () => {
          now += 13_000;
          return now;
        },
      }),
    ).rejects.toThrow("progress saved");
    expect(f.receipt.confirmed_event_ids).toEqual(["laevent00001"]);
    expect(f.receipt.phase).toBe("updating");
  });

  test("a receipt without an update lease is refused outright", async () => {
    for (const overrides of [
      { phase: "synced" as const },
      { claim_token: null },
    ]) {
      const f = fixture(overrides);
      await expect(
        reconcilePersonalCalendarUpdate(f.receipt, f.dependencies),
      ).rejects.toBeInstanceOf(CalendarSyncError);
      expect(f.calls).toEqual([]);
    }
  });

  test("the create and removal reconciler never touches an updating receipt", async () => {
    const f = fixture();
    const writes: string[] = [];
    await expect(
      reconcilePersonalCalendar(f.receipt, {
        advance: f.dependencies.advance,
        destination: async () => "owned@example.test",
        events: () => [shift("Recreated")],
        create: async (_calendarId, id) => {
          writes.push(`create:${id}`);
          return true;
        },
        remove: async (_calendarId, id) => {
          writes.push(`remove:${id}`);
          return true;
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(writes).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});

test("the frozen source carries exactly the fields an event is rendered from", () => {
  const project = {
    id: "10000000-0000-4000-8000-000000000001",
    creator_id: "20000000-0000-4000-8000-000000000001",
    title: "Fictional park cleanup",
    description: "Synthetic",
    location: "Local",
    event_type: "oneTime",
    schedule: {
      oneTime: {
        date: "2030-10-10",
        startTime: "10:00",
        endTime: "12:00",
        volunteers: 20,
      },
    },
    status: "upcoming",
    workflow_status: "published",
    visibility: "public",
    cover_image_url: "https://example.test/cover.png",
  } as unknown as Project;
  expect(personalCalendarProjectSource(project)).toEqual({
    id: project.id,
    creator_id: project.creator_id,
    title: "Fictional park cleanup",
    description: "Synthetic",
    location: "Local",
    event_type: "oneTime",
    schedule: project.schedule,
    project_timezone: null,
    status: "upcoming",
    workflow_status: "published",
  });
});
