import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "react";
import type { UseUserProfileReturn } from "@/hooks/useUserProfile";

// A minimal host for the component's own state and its one effect. The hook
// that owns the read is mocked here and covered by its own recovery test.
type EffectRecord = {
  ran?: boolean;
  deps?: readonly unknown[];
  cleanup?: () => void;
};
type Timer = { id: number; run: () => void; delay: number | undefined };

let slots: unknown[] = [];
let cursor = 0;
let stateChanges = 0;
let queuedEffects: Array<() => void> = [];
let timers: Timer[] = [];
let nextTimerId = 0;

mock.module("react", () => ({
  ...React,
  useState: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = initial;
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
  useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = {};
    const record = slots[slot] as EffectRecord;
    const unchanged =
      record.ran &&
      record.deps?.length === deps?.length &&
      record.deps?.every((value, index) => Object.is(value, deps?.[index]));
    if (unchanged) return;
    queuedEffects.push(() => {
      record.cleanup?.();
      const cleanup = run();
      record.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      record.deps = deps;
      record.ran = true;
    });
  },
}));

let auth: { user: { id: string } | null; loading: boolean };
let hookState: UseUserProfileReturn;
let refetchCalls = 0;

const ProfileForm = () => null;
const VisibilitySection = () => null;
const EmailAddressesSection = () => null;

mock.module("@/hooks/useAuth", () => ({ useAuth: () => auth }));
mock.module("@/hooks/useUserProfile", () => ({
  useUserProfile: () => hookState,
}));
mock.module("./ProfileForm", () => ({ ProfileForm }));
mock.module("./VisibilitySection", () => ({ VisibilitySection }));
mock.module("./EmailAddressesSection", () => ({ EmailAddressesSection }));

const { Alert } = await import("@/components/ui/alert");
const { default: ProfileClient } = await import("./ProfileClient");

type Node = React.ReactElement<Record<string, unknown>>;

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (React.isValidElement<Record<string, unknown>>(value))
    return text(value.props.children);
  return "";
}

/** Render until the effect and the state it sets have settled. */
function render() {
  for (let pass = 0; pass < 20; pass++) {
    const before = stateChanges;
    cursor = 0;
    queuedEffects = [];
    const output = ProfileClient();
    for (const effect of queuedEffects.splice(0)) effect();
    if (stateChanges === before) return output;
  }
  throw new Error("The component did not settle");
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

/** Let every pending timer fire, as it would once its delay has passed. */
function elapse() {
  for (const timer of timers.splice(0)) timer.run();
  return render();
}

const byType = (output: unknown, type: unknown) =>
  nodes(output).filter((node) => node.type === type);
const button = (output: unknown, label: string) =>
  nodes(output).find((node) => node.props.children === label);
const press = (node: Node | undefined) => {
  expect(node).toBeDefined();
  (node!.props.onClick as () => void)();
};

const profile = {
  id: "account-a",
  full_name: "Sample Volunteer",
  avatar_url: null,
  username: "sample.volunteer",
  phone: null,
  profile_visibility: "private" as const,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: null,
  volunteer_goals: null,
};

function hook(overrides: Partial<UseUserProfileReturn>): UseUserProfileReturn {
  return {
    profile: null,
    settings: null,
    loading: false,
    pending: null,
    error: null,
    errorSource: null,
    refetch: async () => {
      refetchCalls++;
    },
    ...overrides,
  };
}

const reading = () => hook({ loading: true, pending: "profile" });

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeEach(() => {
  slots = [];
  cursor = 0;
  stateChanges = 0;
  queuedEffects = [];
  timers = [];
  nextTimerId = 0;
  refetchCalls = 0;
  auth = { user: { id: "account-a" }, loading: false };
  hookState = reading();
  globalThis.setTimeout = ((run: () => void, delay?: number) => {
    const id = ++nextTimerId;
    timers.push({ id, run, delay });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    timers = timers.filter((timer) => timer.id !== id);
  }) as unknown as typeof clearTimeout;
});

afterEach(() => {
  unmount();
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

test("a load inside the deadline shows placeholders and no notice", () => {
  const output = render();
  expect(byType(output, Alert)).toHaveLength(0);
  expect(byType(output, ProfileForm)[0].props.isDataLoading).toBe(true);
  expect(timers.map((timer) => timer.delay)).toEqual([10_000]);

  hookState = hook({ profile });
  const loaded = render();
  expect(timers).toHaveLength(0);
  expect(byType(loaded, Alert)).toHaveLength(0);
  expect(byType(loaded, ProfileForm)[0].props.profile).toBe(profile);
  expect(byType(loaded, ProfileForm)[0].props.isDataLoading).toBe(false);
});

test("a slow profile read gets a polite hint that does not call it a failure", () => {
  render();
  const slow = elapse();
  const [hint] = byType(slow, Alert);
  expect(hint.props.role).toBe("status");
  expect(hint.props.variant).toBe("info");
  expect(text(slow)).toContain("Still loading your profile");
  expect(text(slow)).toContain("It may still finish on its own.");
  expect(text(slow)).not.toContain("could not");
  expect(button(slow, "Reload page")).toBeUndefined();
  // The placeholders stay. Nothing is presented as loaded or as empty.
  expect(byType(slow, ProfileForm)[0].props.isDataLoading).toBe(true);
  expect(refetchCalls).toBe(0);
});

test("retrying a slow read asks the hook once and starts a new deadline", () => {
  render();
  press(button(elapse(), "Try again"));
  expect(refetchCalls).toBe(1);

  const retrying = render();
  expect(byType(retrying, Alert)).toHaveLength(0);
  expect(timers).toHaveLength(1);

  expect(text(elapse())).toContain("Still loading your profile");
  expect(refetchCalls).toBe(1);
});

test("a slow read that then succeeds clears the hint and shows the profile", () => {
  render();
  expect(byType(elapse(), Alert)).toHaveLength(1);

  hookState = hook({ profile });
  const loaded = render();
  expect(byType(loaded, Alert)).toHaveLength(0);
  expect(byType(loaded, ProfileForm)[0].props.profile).toBe(profile);
  expect(timers).toHaveLength(0);
});

test("a slow sign-in check offers a reload, since there is no read to retry", () => {
  auth = { user: null, loading: true };
  hookState = hook({ loading: true, pending: "auth" });
  render();
  const slow = elapse();
  expect(text(slow)).toContain("Still loading your profile");
  expect(button(slow, "Reload page")).toBeDefined();
  expect(button(slow, "Try again")).toBeUndefined();
  expect(refetchCalls).toBe(0);
});

test("a failed read shows an error with a retry and no empty editors", () => {
  hookState = hook({ error: new Error("private provider detail") });
  const failed = render();
  const [notice] = byType(failed, Alert);
  expect(notice.props.variant).toBe("warning");
  expect(notice.props.role).toBeUndefined();
  expect(text(failed)).toContain("Your profile could not be loaded");
  expect(text(failed)).toContain("Nothing was changed.");
  expect(text(failed)).not.toContain("private provider detail");
  expect(byType(failed, ProfileForm)).toHaveLength(0);
  expect(byType(failed, VisibilitySection)).toHaveLength(0);
  expect(byType(failed, EmailAddressesSection)).toHaveLength(1);
  expect(timers).toHaveLength(0);

  press(button(failed, "Try again"));
  expect(refetchCalls).toBe(1);

  // The hook keeps the last error until the retry settles. While it is in
  // flight the page shows placeholders, not the earlier failure.
  hookState = hook({ ...reading(), error: hookState.error });
  const retrying = render();
  expect(byType(retrying, Alert)).toHaveLength(0);
  expect(byType(retrying, ProfileForm)[0].props.isDataLoading).toBe(true);
  expect(timers).toHaveLength(1);
});

test("a failed refresh keeps the loaded profile editable and says it may be stale", () => {
  hookState = hook({ profile, error: new Error("private provider detail") });
  const output = render();
  expect(text(output)).toContain("Your profile could not be refreshed");
  expect(text(output)).not.toContain("could not be loaded");
  expect(byType(output, ProfileForm)[0].props.profile).toBe(profile);
  expect(byType(output, VisibilitySection)).toHaveLength(1);
});

test("a settings-only failure keeps the editors and does not call the profile failed", () => {
  hookState = hook({
    profile,
    error: new Error("private provider detail"),
    errorSource: "settings",
  });
  const output = render();
  const [notice] = byType(output, Alert);
  expect(notice.props.variant).toBe("warning");
  expect(text(output)).toContain(
    "Your notification settings could not be loaded",
  );
  expect(text(output)).toContain("Your profile details below are current.");
  expect(text(output)).not.toContain("Your profile could not be");
  expect(text(output)).not.toContain("out of date");
  expect(text(output)).not.toContain("private provider detail");
  expect(byType(output, ProfileForm)[0].props.profile).toBe(profile);
  expect(byType(output, VisibilitySection)).toHaveLength(1);

  press(button(output, "Try again"));
  expect(refetchCalls).toBe(1);
});

test("a settings-only failure with no profile row still shows the editors", () => {
  hookState = hook({
    error: new Error("private provider detail"),
    errorSource: "settings",
  });
  const output = render();
  expect(text(output)).not.toContain("Your profile could not be");
  expect(byType(output, ProfileForm)[0].props.profile).toBeNull();
  expect(byType(output, VisibilitySection)).toHaveLength(1);
});

test("a valid empty profile renders the editors with no notice", () => {
  hookState = hook({});
  const output = render();
  expect(byType(output, Alert)).toHaveLength(0);
  const [form] = byType(output, ProfileForm);
  expect(form.props.profile).toBeNull();
  expect(form.props.isDataLoading).toBe(false);
  expect(byType(output, VisibilitySection)).toHaveLength(1);
});

test("an account change drops the previous account's hint and restarts the deadline", () => {
  render();
  expect(byType(elapse(), Alert)).toHaveLength(1);

  auth = { user: { id: "account-b" }, loading: false };
  const switched = render();
  expect(byType(switched, Alert)).toHaveLength(0);
  expect(byType(switched, ProfileForm)[0].props.profile).toBeNull();
  expect(timers).toHaveLength(1);
});

test("unmounting while loading leaves no timer behind", () => {
  render();
  expect(timers).toHaveLength(1);
  const before = stateChanges;
  unmount();
  expect(timers).toHaveLength(0);
  expect(stateChanges).toBe(before);
});
