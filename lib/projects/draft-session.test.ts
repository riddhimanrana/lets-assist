import { describe, expect, test } from "bun:test";
import { createProjectDraftSession } from "./draft-session";
import { createInitialEventFormState } from "@/hooks/use-event-form";

function fixture(initialId?: string) {
  const drafts = new Map([
    ["first", createInitialEventFormState({ organizationId: "org-a" })],
    ["second", createInitialEventFormState({ organizationId: "org-b" })],
  ]);
  const originals = structuredClone(drafts);
  let next = 0;
  const session = createProjectDraftSession(initialId, {
    save: async (data, id = `created-${++next}`) => {
      drafts.set(id, createInitialEventFormState({ draft: data }));
      return { id, autosaved: true };
    },
    copy: async (data) => {
      const id = `copy-${++next}`;
      drafts.set(id, createInitialEventFormState({ draft: data }));
      return { id };
    },
    remove: async (id) => {
      drafts.delete(id);
      return {};
    },
  });
  return { session, drafts, originals };
}

describe("project draft intent and lifecycle", () => {
  test("new creation saves and publishes without changing unrelated drafts", async () => {
    const { session, drafts, originals } = fixture();
    const data = createInitialEventFormState({ organizationId: "org-c" });
    data.basicInfo.title = "Fictional garden cleanup";
    expect(data.basicInfo.organizationId).toBe("org-c");
    expect(session.id).toBeUndefined();
    await session.save(data);
    expect(drafts.size).toBe(3);
    expect(drafts.get("first")).toEqual(originals.get("first"));
    expect(drafts.get("second")).toEqual(originals.get("second"));
    await session.consume();
    expect(drafts).toEqual(originals);
    expect(session.id).toBeUndefined();
  });

  test("explicit resume preserves the saved organization and changes only that draft", async () => {
    const { session, drafts, originals } = fixture("first");
    const data = createInitialEventFormState({
      draft: drafts.get("first"),
      organizationId: "unrelated-route-org",
    });
    expect(data.basicInfo.organizationId).toBe("org-a");
    data.basicInfo.title = "Updated fictional event";
    await session.save(data);
    expect(drafts.get("first")?.basicInfo.title).toBe(data.basicInfo.title);
    expect(drafts.get("second")).toEqual(originals.get("second"));
    await session.consume();
    expect([...drafts.keys()]).toEqual(["second"]);
  });

  test("save as new switches edits and publication to the copy", async () => {
    const { session, drafts, originals } = fixture("first");
    const data = createInitialEventFormState({ draft: drafts.get("first") });
    const copy = await session.copy(data);
    expect(session.id).toBe(copy.id);
    data.basicInfo.title = "Changes after copying";
    await session.save(data);
    expect(drafts.get(copy.id!)?.basicInfo.title).toBe(data.basicInfo.title);
    expect(drafts.get("first")).toEqual(originals.get("first"));
    await session.consume();
    expect(drafts).toEqual(originals);
  });

  test("publication waits for first autosave and refuses later writes", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<{ id: string; autosaved: boolean }>();
    const removed: string[] = [];
    const session = createProjectDraftSession(undefined, {
      save: async () => {
        started.resolve();
        return release.promise;
      },
      copy: async () => ({ id: "unused" }),
      remove: async (id) => {
        removed.push(id);
        return {};
      },
    });
    const pendingSave = session.save({});
    await started.promise;
    const publication = session.consume();
    expect(removed).toEqual([]);
    expect(await session.save({})).toHaveProperty("error");
    release.resolve({ id: "owned-in-flight", autosaved: true });
    await pendingSave;
    await publication;
    expect(removed).toEqual(["owned-in-flight"]);
  });

  test("a failed copy preserves the prior target and failed cleanup preserves recovery", async () => {
    const targets: (string | undefined)[] = [];
    const session = createProjectDraftSession("first", {
      save: async (_data, id) => {
        targets.push(id);
        return { id };
      },
      copy: async () => ({ error: "Storage unavailable" }),
      remove: async () => ({ error: "Deletion unavailable" }),
    });
    await session.copy({});
    await session.save({});
    expect(targets).toEqual(["first"]);
    expect(await session.consume()).toHaveProperty("error");
    expect(session.id).toBe("first");
  });

  test("new form states do not share mutable schedules", () => {
    const first = createInitialEventFormState();
    const second = createInitialEventFormState();
    first.schedule.multiDay[0].slots[0].name = "Different event";
    expect(second.schedule.multiDay[0].slots[0].name).toBe("");
    expect(second.basicInfo.title).toBe("");
    expect(second.basicInfo.organizationId).toBeNull();
  });
});
