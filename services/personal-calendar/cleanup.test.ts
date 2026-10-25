import { afterAll, expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
let data: unknown = [];
let error: unknown = null;
const rpc = mock(async (_name: string, _args: unknown) => ({ data, error }));
mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ rpc }),
}));
const { getPersonalCalendarCleanup } = await import("./cleanup");
afterAll(() => mock.restore());
test("loads only the actor-scoped cleanup DTO", async () => {
  data = [
    {
      source_kind: "project",
      source_id: "10000000-0000-4000-8000-000000000001",
      event_id: "event12345",
    },
  ];
  expect(await getPersonalCalendarCleanup("actor-one")).toEqual([
    {
      source_kind: "project",
      source_id: "10000000-0000-4000-8000-000000000001",
      event_id: "event12345",
    },
  ]);
  expect(rpc).toHaveBeenCalledWith("list_personal_calendar_cleanup", {
    p_actor_user_id: "actor-one",
  });
});
test("does not hide receipt read failures behind an empty list", async () => {
  error = { code: "fixture" };
  await expect(getPersonalCalendarCleanup("actor-one")).rejects.toThrow(
    "could not be loaded",
  );
  error = null;
  data = [{ event_id: "../../other" }];
  await expect(getPersonalCalendarCleanup("actor-one")).rejects.toThrow(
    "could not be loaded",
  );
});
