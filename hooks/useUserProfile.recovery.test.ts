import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";

// A minimal hook host: state, refs, memo and effects with dependency checks
// and cleanup. The lifecycle fences and the hook itself are the real modules.
type EffectRecord = {
  ran?: boolean;
  deps?: readonly unknown[];
  cleanup?: () => void;
};

let slots: unknown[] = [];
let cursor = 0;
let stateChanges = 0;
let queuedEffects: Array<() => void> = [];

function sameDeps(one?: readonly unknown[], other?: readonly unknown[]) {
  if (!one || !other || one.length !== other.length) return false;
  return one.every((value, index) => Object.is(value, other[index]));
}

function memo<T>(factory: () => T, deps?: readonly unknown[]): T {
  const slot = cursor++;
  const previous = slots[slot] as
    { deps?: readonly unknown[]; value: T } | undefined;
  if (previous && sameDeps(previous.deps, deps)) return previous.value;
  const value = factory();
  slots[slot] = { deps, value };
  return value;
}

mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in slots)) {
      slots[slot] = typeof initial === "function" ? initial() : initial;
    }
    const owner = slots;
    return [
      owner[slot],
      (next: unknown) => {
        const value = typeof next === "function" ? next(owner[slot]) : next;
        if (Object.is(value, owner[slot])) return;
        owner[slot] = value;
        stateChanges++;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = { current: initial };
    return slots[slot];
  },
  useMemo: memo,
  useCallback: (callback: unknown, deps?: readonly unknown[]) =>
    memo(() => callback, deps),
  useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = {};
    const record = slots[slot] as EffectRecord;
    if (record.ran && sameDeps(record.deps, deps)) return;
    queuedEffects.push(() => {
      record.cleanup?.();
      const cleanup = run();
      record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      record.deps = deps;
      record.ran = true;
    });
  },
}));

type QueryResult = { data: unknown; error: unknown };
type Query = {
  table: string;
  userId: string;
  settle: (result: QueryResult) => void;
};
type RealtimeHandler = (payload: {
  eventType: string;
  new: unknown;
  old: unknown;
}) => void;
type Channel = { name: string; handler?: RealtimeHandler };

let queries: Query[] = [];
let channels: Channel[] = [];
let removedChannels: unknown[] = [];
let loggedEvents: unknown[] = [];
let auth: { user: { id: string } | null; loading: boolean };

mock.module("@/hooks/useAuth", () => ({ useAuth: () => auth }));
mock.module("@/lib/safe-console", () => ({
  safeConsole: {
    debug: () => {},
    info: () => {},
    log: () => {},
    warn: () => {},
    error: (event: unknown) => {
      loggedEvents.push(event);
    },
  },
}));
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: () =>
            new Promise<QueryResult>((settle) => {
              queries.push({ table, userId, settle });
            }),
        }),
      }),
    }),
    channel: (name: string) => {
      const channel: Channel & {
        on: (...args: unknown[]) => unknown;
        subscribe: () => unknown;
      } = {
        name,
        on: (_event, _filter, handler) => {
          channel.handler = handler as RealtimeHandler;
          return channel;
        },
        subscribe: () => channel,
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: (channel: unknown) => {
      removedChannels.push(channel);
    },
  }),
}));

const { useUserProfile } = await import("./useUserProfile");

/** Render until effects and the state they set have settled. */
function render() {
  for (let pass = 0; pass < 20; pass++) {
    const before = stateChanges;
    cursor = 0;
    queuedEffects = [];
    const output = useUserProfile();
    for (const effect of queuedEffects.splice(0)) effect();
    if (stateChanges === before) return output;
  }
  throw new Error("The hook did not settle");
}

function unmount() {
  for (const slot of slots) {
    const record = slot as EffectRecord | null | undefined;
    if (record && typeof record === "object" && "ran" in record) {
      record.cleanup?.();
      record.cleanup = undefined;
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function row(id: string, fullName: string) {
  return {
    id,
    full_name: fullName,
    avatar_url: null,
    username: null,
    phone: null,
    profile_visibility: "private",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    volunteer_goals: null,
  };
}

function settingsRow(userId: string) {
  return {
    user_id: userId,
    email_notifications: true,
    project_updates: true,
    general: false,
  };
}

/** Each read is one profiles query followed by one settings query. */
async function settleRead(
  index: number,
  profile: QueryResult,
  settings: QueryResult = { data: null, error: null },
) {
  const profileQuery = queries[index * 2];
  const settingsQuery = queries[index * 2 + 1];
  expect(profileQuery.table).toBe("profiles");
  expect(settingsQuery.table).toBe("notification_settings");
  profileQuery.settle(profile);
  settingsQuery.settle(settings);
  await flush();
}

const failure = { data: null, error: new Error("fictional read failure") };

beforeEach(() => {
  slots = [];
  cursor = 0;
  stateChanges = 0;
  queuedEffects = [];
  queries = [];
  channels = [];
  removedChannels = [];
  loggedEvents = [];
  auth = { user: { id: "account-a" }, loading: false };
});

afterEach(() => {
  unmount();
});

test("a failed read is returned as an error for the signed-in account", async () => {
  const loading = render();
  expect(loading.loading).toBe(true);
  expect(loading.pending).toBe("profile");
  expect(loading.error).toBeNull();
  expect(queries.map((query) => query.userId)).toEqual([
    "account-a",
    "account-a",
  ]);

  await settleRead(0, failure);
  const failed = render();
  expect(failed.loading).toBe(false);
  expect(failed.pending).toBeNull();
  expect(failed.error).toBe(failure.error);
  expect(failed.profile).toBeNull();
  expect(loggedEvents).toEqual(["[useUserProfile] Fetch error:"]);
});

test("a failed profile read is reported as a profile failure", async () => {
  render();
  await settleRead(0, failure, { data: settingsRow("account-a"), error: null });
  const failed = render();
  expect(failed.error).toBe(failure.error);
  expect(failed.errorSource).toBe("profile");
  expect(failed.profile).toBeNull();
  expect(failed.settings).toBeNull();
});

test("a provider error object is returned as an Error", async () => {
  render();
  await settleRead(
    0,
    { data: row("account-a", "Sample Volunteer"), error: null },
    { data: null, error: { code: "57014", message: "fictional timeout" } },
  );
  const failed = render();
  expect(failed.error).toBeInstanceOf(Error);
  expect(failed.errorSource).toBe("settings");
  expect(failed.profile?.full_name).toBe("Sample Volunteer");
});

test("a settings failure keeps the profile that was read with it", async () => {
  render();
  await settleRead(
    0,
    { data: row("account-a", "Sample Volunteer"), error: null },
    failure,
  );
  const partial = render();
  expect(partial.loading).toBe(false);
  expect(partial.pending).toBeNull();
  expect(partial.profile?.full_name).toBe("Sample Volunteer");
  expect(partial.settings).toBeNull();
  expect(partial.error).toBe(failure.error);
  expect(partial.errorSource).toBe("settings");
  expect(loggedEvents).toEqual(["[useUserProfile] Fetch error:"]);

  // A retry that reads both rows clears the partial failure.
  const retry = partial.refetch();
  await settleRead(
    1,
    { data: row("account-a", "Sample Volunteer"), error: null },
    { data: settingsRow("account-a"), error: null },
  );
  await retry;
  const recovered = render();
  expect(recovered.error).toBeNull();
  expect(recovered.errorSource).toBeNull();
  expect(recovered.settings?.user_id).toBe("account-a");
});

test("a settings failure on refresh takes the fresh profile and keeps the settings already held", async () => {
  render();
  await settleRead(
    0,
    { data: row("account-a", "Before"), error: null },
    { data: settingsRow("account-a"), error: null },
  );
  const loaded = render();
  expect(loaded.settings?.user_id).toBe("account-a");

  void loaded.refetch();
  await settleRead(
    1,
    { data: row("account-a", "After"), error: null },
    failure,
  );
  const partial = render();
  expect(partial.profile?.full_name).toBe("After");
  expect(partial.settings?.user_id).toBe("account-a");
  expect(partial.error).toBe(failure.error);
  expect(partial.errorSource).toBe("settings");
});

test("a superseded settings failure cannot replace the newer result or report an error", async () => {
  const first = render();
  void first.refetch();
  await settleRead(
    1,
    { data: row("account-a", "Current"), error: null },
    { data: settingsRow("account-a"), error: null },
  );
  await settleRead(
    0,
    { data: row("account-a", "Superseded"), error: null },
    failure,
  );
  const settled = render();
  expect(settled.loading).toBe(false);
  expect(settled.profile?.full_name).toBe("Current");
  expect(settled.settings?.user_id).toBe("account-a");
  expect(settled.error).toBeNull();
  expect(settled.errorSource).toBeNull();
  expect(loggedEvents).toEqual([]);
});

test("a settings failure stays with its own account across an account change", async () => {
  render();
  auth = { user: { id: "account-b" }, loading: false };
  render();

  // The first account's read answers late, with its settings read failed.
  await settleRead(
    0,
    { data: row("account-a", "Previous"), error: null },
    failure,
  );
  const stillLoading = render();
  expect(stillLoading.loading).toBe(true);
  expect(stillLoading.profile).toBeNull();
  expect(stillLoading.error).toBeNull();
  expect(stillLoading.errorSource).toBeNull();
  expect(loggedEvents).toEqual([]);

  await settleRead(
    1,
    { data: row("account-b", "Current"), error: null },
    failure,
  );
  const partial = render();
  expect(partial.profile?.id).toBe("account-b");
  expect(partial.error).toBe(failure.error);
  expect(partial.errorSource).toBe("settings");

  // Back on the first account, the other account's rows and error are gone.
  auth = { user: { id: "account-a" }, loading: false };
  const back = render();
  expect(back.loading).toBe(true);
  expect(back.profile).toBeNull();
  expect(back.error).toBeNull();
  expect(back.errorSource).toBeNull();
});

test("a read with no rows is a valid empty profile, not an error", async () => {
  render();
  await settleRead(0, { data: null, error: null });
  const empty = render();
  expect(empty.loading).toBe(false);
  expect(empty.error).toBeNull();
  expect(empty.profile).toBeNull();
  expect(empty.settings).toBeNull();
});

test("an explicit retry starts one fresh read and its success replaces the error", async () => {
  render();
  await settleRead(0, failure);
  const failed = render();

  const retry = failed.refetch();
  expect(queries).toHaveLength(4);
  const retrying = render();
  expect(retrying.loading).toBe(true);
  expect(retrying.pending).toBe("profile");
  expect(retrying.profile).toBeNull();

  await settleRead(
    1,
    { data: row("account-a", "Sample Volunteer"), error: null },
    {
      data: {
        user_id: "account-a",
        email_notifications: true,
        project_updates: true,
        general: false,
      },
      error: null,
    },
  );
  await retry;
  const recovered = render();
  expect(recovered.loading).toBe(false);
  expect(recovered.error).toBeNull();
  expect(recovered.profile?.full_name).toBe("Sample Volunteer");
  expect(recovered.settings?.user_id).toBe("account-a");
});

test("a failed retry keeps the profile that was already loaded", async () => {
  render();
  await settleRead(0, {
    data: row("account-a", "Sample Volunteer"),
    error: null,
  });
  const loaded = render();
  expect(loaded.profile?.full_name).toBe("Sample Volunteer");

  void loaded.refetch();
  await settleRead(1, failure);
  const failed = render();
  expect(failed.loading).toBe(false);
  expect(failed.error).toBe(failure.error);
  expect(failed.profile?.full_name).toBe("Sample Volunteer");
});

test("a superseded read cannot end loading or replace the retry's result", async () => {
  const first = render();
  void first.refetch();
  expect(queries).toHaveLength(4);

  await settleRead(0, { data: row("account-a", "Superseded"), error: null });
  const waiting = render();
  expect(waiting.loading).toBe(true);
  expect(waiting.profile).toBeNull();

  await settleRead(1, { data: row("account-a", "Current"), error: null });
  const settled = render();
  expect(settled.loading).toBe(false);
  expect(settled.profile?.full_name).toBe("Current");
});

test("a superseded failure cannot mark the newer result as failed", async () => {
  const first = render();
  void first.refetch();
  await settleRead(1, { data: row("account-a", "Current"), error: null });
  await settleRead(0, failure);
  const settled = render();
  expect(settled.error).toBeNull();
  expect(settled.profile?.full_name).toBe("Current");
  expect(loggedEvents).toEqual([]);
});

test("changing account drops the previous account's error, read and updates", async () => {
  render();
  await settleRead(0, failure);
  expect(render().error).toBe(failure.error);
  void render().refetch();

  auth = { user: { id: "account-b" }, loading: false };
  const switched = render();
  expect(switched.error).toBeNull();
  expect(switched.loading).toBe(true);
  expect(switched.profile).toBeNull();
  expect(queries.slice(4).map((query) => query.userId)).toEqual([
    "account-b",
    "account-b",
  ]);
  expect(removedChannels).toContain(channels[0]);
  expect(channels[1].name).toContain("account-b");

  // The first account's retry and realtime channel both answer late.
  await settleRead(1, { data: row("account-a", "Previous"), error: null });
  channels[0].handler?.({
    eventType: "UPDATE",
    new: row("account-a", "Previous"),
    old: {},
  });
  const stillLoading = render();
  expect(stillLoading.loading).toBe(true);
  expect(stillLoading.profile).toBeNull();

  await settleRead(2, { data: row("account-b", "Current"), error: null });
  const settled = render();
  expect(settled.loading).toBe(false);
  expect(settled.profile?.id).toBe("account-b");
  expect(settled.profile?.full_name).toBe("Current");
});

test("signing out clears the account and ignores its late read", async () => {
  render();
  auth = { user: null, loading: false };
  const signedOut = render();
  expect(signedOut.loading).toBe(false);
  expect(signedOut.pending).toBeNull();
  expect(signedOut.error).toBeNull();
  expect(signedOut.profile).toBeNull();

  await settleRead(0, { data: row("account-a", "Previous"), error: null });
  const after = render();
  expect(after.profile).toBeNull();
  expect(after.loading).toBe(false);
});

test("while sign-in is still resolving there is no read and nothing to retry", async () => {
  auth = { user: null, loading: true };
  const waiting = render();
  expect(waiting.loading).toBe(true);
  expect(waiting.pending).toBe("auth");
  await waiting.refetch();
  expect(queries).toHaveLength(0);
});

test("a read that completes after unmount changes nothing", async () => {
  render();
  unmount();
  expect(removedChannels).toContain(channels[0]);
  const before = stateChanges;
  await settleRead(0, { data: row("account-a", "Late"), error: null });
  expect(stateChanges).toBe(before);
  expect(loggedEvents).toEqual([]);
});
