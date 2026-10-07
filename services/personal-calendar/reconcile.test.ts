import { describe, expect, test } from "bun:test";
import {
  CalendarSyncError,
  personalCalendarEventId,
  reconcilePersonalCalendar,
  type PersonalCalendarEvent,
  type PersonalCalendarReceipt,
  type CalendarReceiptStep,
} from "./reconcile";

const event: PersonalCalendarEvent = {
  summary: "Fictional park cleanup",
  start: { dateTime: "2026-10-10T10:00:00", timeZone: "America/Los_Angeles" },
  end: { dateTime: "2026-10-10T11:00:00", timeZone: "America/Los_Angeles" },
};
function fixture() {
  let saved: PersonalCalendarReceipt = {
    source_kind: "project",
    source_id: "10000000-0000-4000-8000-000000000001",
    user_id: "20000000-0000-4000-8000-000000000001",
    project_id: "10000000-0000-4000-8000-000000000001",
    generation: "30000000-0000-4000-8000-000000000001",
    phase: "syncing",
    requested_schedule_id: null,
    legacy_event_id: null,
    calendar_id: null,
    events: [],
    confirmed_event_ids: [],
    claim_token: "40000000-0000-4000-8000-000000000001",
  };
  const provider = new Map<string, PersonalCalendarEvent>();
  const calls: string[] = [];
  let failStep: CalendarReceiptStep | undefined;
  let failProviderId: string | undefined;
  const dependencies = {
    async advance(
      receipt: PersonalCalendarReceipt,
      step: CalendarReceiptStep,
      payload: Record<string, unknown> = {},
    ) {
      calls.push(step);
      if (failStep === step) {
        failStep = undefined;
        throw new Error("database unavailable");
      }
      if (step === "plan") {
        saved.calendar_id = payload.calendar_id as string;
        saved.events = structuredClone(
          payload.events,
        ) as PersonalCalendarReceipt["events"];
      }
      if (step === "confirm")
        saved.confirmed_event_ids.push(payload.event_id as string);
      if (step === "finish")
        saved.phase = saved.phase === "syncing" ? "synced" : "removed";
      return structuredClone(saved);
    },
    async destination(create: boolean) {
      calls.push(`destination:${create}`);
      return "owned@group.calendar.google.com";
    },
    events: () => [event, { ...event, summary: "Second shift" }],
    async create(calendarId: string, id: string, data: PersonalCalendarEvent) {
      calls.push(`create:${id}`);
      expect(saved.calendar_id).toBe(calendarId);
      expect(saved.events.some((entry) => entry.id === id)).toBe(true);
      if (id === failProviderId) return false;
      provider.set(id, data);
      return true;
    },
    async remove(calendarId: string, id: string) {
      calls.push(`remove:${id}`);
      expect(calendarId).toBe(saved.calendar_id!);
      if (id === failProviderId) return false;
      provider.delete(id);
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
    failStep(step: CalendarReceiptStep) {
      failStep = step;
    },
    failProvider(id?: string) {
      failProviderId = id;
    },
    calls,
    provider,
    dependencies,
  };
}

describe("durable personal calendar reconciliation", () => {
  test("persists every occurrence before provider writes and only then marks synced", async () => {
    const f = fixture();
    const result = await reconcilePersonalCalendar(f.receipt, f.dependencies);
    expect(result.phase).toBe("synced");
    expect(f.receipt.events).toHaveLength(2);
    expect(f.provider.size).toBe(2);
    expect(f.calls.indexOf("plan")).toBeLessThan(
      f.calls.findIndex((call) => call.startsWith("create:")),
    );
    expect(f.calls.at(-1)).toBe("finish");
    expect(f.receipt.confirmed_event_ids).toEqual(
      f.receipt.events.map(({ id }) => id),
    );
  });
  test("retries partial creation using its saved plan after the project changes", async () => {
    const f = fixture();
    f.failProvider(personalCalendarEventId(f.receipt.generation, 1));
    await expect(
      reconcilePersonalCalendar(f.receipt, f.dependencies),
    ).rejects.toBeInstanceOf(CalendarSyncError);
    expect(f.receipt.phase).toBe("syncing");
    expect(f.provider.size).toBe(1);
    f.failProvider();
    f.dependencies.events = () => {
      throw new Error("must use saved snapshot");
    };
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    expect(f.provider.size).toBe(2);
    expect(
      f.calls.filter((call) => call === `create:${f.receipt.events[0].id}`),
    ).toHaveLength(1);
    expect(f.calls.filter((call) => call === "plan")).toHaveLength(1);
  });
  test("replays the same provider identity when saving confirmation fails", async () => {
    const f = fixture();
    f.failStep("confirm");
    await expect(
      reconcilePersonalCalendar(f.receipt, f.dependencies),
    ).rejects.toThrow("database unavailable");
    expect(f.provider.size).toBe(1);
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    expect(f.provider.size).toBe(2);
    const first = f.receipt.events[0].id;
    expect(f.calls.filter((call) => call === `create:${first}`)).toHaveLength(
      2,
    );
  });
  test("cannot issue a provider mutation when plan persistence or renewal fails", async () => {
    for (const step of ["plan", "renew"] as const) {
      const f = fixture();
      f.failStep(step);
      await expect(
        reconcilePersonalCalendar(f.receipt, f.dependencies),
      ).rejects.toThrow();
      expect(f.provider.size).toBe(0);
    }
  });
  test("resumes deletion of every planned ID including an unconfirmed create", async () => {
    const f = fixture();
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    f.receipt = { ...f.receipt, phase: "removing", confirmed_event_ids: [] };
    f.failProvider(f.receipt.events[1].id);
    await expect(
      reconcilePersonalCalendar(f.receipt, f.dependencies),
    ).rejects.toThrow();
    expect(f.provider.size).toBe(1);
    expect(f.receipt.phase).toBe("removing");
    f.failProvider();
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    expect(f.provider.size).toBe(0);
    expect(f.receipt.phase).toBe("removed");
    expect(
      f.calls.filter((call) => call === `remove:${f.receipt.events[0].id}`),
    ).toHaveLength(1);
  });
  test("legacy removal uses the known event and never provisions a calendar", async () => {
    const f = fixture();
    f.receipt = {
      ...f.receipt,
      phase: "removing",
      legacy_event_id: "legacyevent123",
    };
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    expect(f.receipt.events).toEqual([{ id: "legacyevent123", event: null }]);
    expect(f.calls).toContain("destination:false");
    expect(f.calls).not.toContain("destination:true");
  });
  test("terminal receipt replay makes no provider or database writes", async () => {
    const f = fixture();
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    f.calls.length = 0;
    await reconcilePersonalCalendar(f.receipt, f.dependencies);
    expect(f.calls).toEqual([]);
  });
  test("bounded request duration saves progress for another request", async () => {
    const f = fixture();
    let now = 0;
    await expect(
      reconcilePersonalCalendar(f.receipt, {
        ...f.dependencies,
        now: () => {
          now += 13_000;
          return now;
        },
      }),
    ).rejects.toThrow("progress saved");
    expect(f.provider.size).toBe(1);
    expect(f.receipt.confirmed_event_ids).toHaveLength(1);
  });
  test("different generations cannot reuse deleted provider identities", () => {
    expect(personalCalendarEventId("generation-one", 0)).toMatch(
      /^[a-v0-9]{5,1024}$/,
    );
    expect(personalCalendarEventId("generation-one", 0)).not.toBe(
      personalCalendarEventId("generation-two", 0),
    );
    expect(personalCalendarEventId("generation-one", 0)).not.toBe(
      personalCalendarEventId("generation-one", 1),
    );
  });
});
