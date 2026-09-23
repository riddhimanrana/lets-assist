import { describe, expect, test } from "bun:test";
import { createAuthStateLifecycle } from "./auth-state-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const requests: ReturnType<typeof deferred<string>>[] = [];
  const currentChecks: (() => boolean)[] = [];
  let user: string | null = null;
  let loading = false;
  const errors: unknown[] = [];
  const lifecycle = createAuthStateLifecycle({
    resolve: (isCurrent) => {
      const request = deferred<string>();
      requests.push(request);
      currentChecks.push(isCurrent);
      return request.promise;
    },
    onStart: () => {
      loading = true;
    },
    onResolved: (value) => {
      user = value;
    },
    onSignedOut: () => {
      user = null;
    },
    onError: (error) => {
      errors.push(error);
      user = null;
    },
    onSettled: () => {
      loading = false;
    },
  });
  return {
    lifecycle,
    requests,
    currentChecks,
    errors,
    state: () => ({ user, loading }),
  };
}

describe("auth state request ordering", () => {
  test("an older claims or MFA result cannot restore a signed-out user", async () => {
    const f = fixture();
    const pending = f.lifecycle.refresh();
    f.lifecycle.signedOut();
    f.requests[0].resolve("previous-account");
    await pending;
    expect(f.currentChecks[0]()).toBe(false);
    expect(f.state()).toEqual({ user: null, loading: false });
  });

  test("an older account result cannot replace a newer authenticated account", async () => {
    const f = fixture();
    const old = f.lifecycle.refresh();
    const fresh = f.lifecycle.refresh();
    f.requests[1].resolve("current-account");
    await fresh;
    f.requests[0].resolve("previous-account");
    await old;
    expect(f.state()).toEqual({ user: "current-account", loading: false });
  });

  test("stale completion cannot clear loading for a newer request", async () => {
    const f = fixture();
    const old = f.lifecycle.refresh();
    const fresh = f.lifecycle.refresh();
    f.requests[0].resolve("previous-account");
    await old;
    expect(f.state()).toEqual({ user: null, loading: true });
    f.requests[1].resolve("current-account");
    await fresh;
    expect(f.state()).toEqual({ user: "current-account", loading: false });
  });

  test("stale rejection cannot clear a newer account", async () => {
    const f = fixture();
    const old = f.lifecycle.refresh();
    const fresh = f.lifecycle.refresh();
    f.requests[1].resolve("current-account");
    await fresh;
    f.requests[0].reject(new Error("old request failed"));
    await old;
    expect(f.errors).toEqual([]);
    expect(f.state().user).toBe("current-account");
  });

  test("logout cancels a deferred auth callback before it makes requests", async () => {
    const f = fixture();
    f.lifecycle.refresh(true);
    f.lifecycle.signedOut();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.requests).toHaveLength(0);
    expect(f.state()).toEqual({ user: null, loading: false });
  });

  test("only the newest deferred auth event starts a lookup", async () => {
    const f = fixture();
    f.lifecycle.refresh(true);
    f.lifecycle.refresh(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(f.requests).toHaveLength(1);
    f.requests[0].resolve("current-account");
    await f.requests[0].promise;
    expect(f.state()).toEqual({ user: "current-account", loading: false });
  });

  test("disposal rejects in-flight and subsequently scheduled results", async () => {
    const f = fixture();
    const pending = f.lifecycle.refresh();
    f.lifecycle.dispose();
    const before = f.state();
    f.requests[0].resolve("unmounted-account");
    await pending;
    f.lifecycle.refresh(true);
    f.lifecycle.signedOut();
    expect(f.requests).toHaveLength(1);
    expect(f.state()).toEqual(before);
  });

  test("a current request failure still clears auth and loading", async () => {
    const f = fixture();
    const pending = f.lifecycle.refresh();
    f.requests[0].reject(new Error("current request failed"));
    await pending;
    expect(f.errors).toHaveLength(1);
    expect(f.state()).toEqual({ user: null, loading: false });
  });

  test("replacing a profile loader cannot apply the previous account's data", async () => {
    type Data = { profile: { id: string }; settings: { user_id: string } };
    const previous = deferred<Data>();
    const current = deferred<Data>();
    let visible: Data | null = null;
    const readVisible = (): Data | null => visible;
    let loading = false;
    const makeLoader = (response: Promise<Data>) =>
      createAuthStateLifecycle({
        resolve: () => response,
        onStart: () => {
          loading = true;
        },
        onResolved: (data) => {
          visible = data;
        },
        onSignedOut: () => {
          visible = null;
        },
        onError: () => {
          visible = null;
        },
        onSettled: () => {
          loading = false;
        },
      });
    const oldLoader = makeLoader(previous.promise);
    const oldRequest = oldLoader.refresh();
    oldLoader.dispose();
    const newLoader = makeLoader(current.promise);
    const newRequest = newLoader.refresh();
    previous.resolve({ profile: { id: "old" }, settings: { user_id: "old" } });
    await oldRequest;
    expect(readVisible()).toBeNull();
    expect(loading).toBe(true);
    const expected = {
      profile: { id: "current" },
      settings: { user_id: "current" },
    };
    current.resolve(expected);
    await newRequest;
    expect(readVisible()).toEqual(expected);
    expect(loading).toBe(false);
  });
});
