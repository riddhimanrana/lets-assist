/**
 * The real useAnonymousAutoLink hook in a React harness on the minimal test
 * DOM, with fake auth and a fake link action. No Supabase, no server action,
 * no real account. Proves effect lifecycle, not the page or the server.
 */
import { describe, expect, test } from "bun:test";
import { StrictMode } from "react";

import { installMinimalDom } from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useAnonymousAutoLink, AUTO_LINK_FAILURE_MESSAGE } =
  await import("./use-anonymous-auto-link");

type Pending<T> = { resolve: (value: T) => void; reject: (e: unknown) => void };

function fixture() {
  const userCalls: Array<Pending<{ id: string } | null>> = [];
  const linkCalls: Array<{
    id: string;
    token: string;
    pending: Pending<{ error?: string }>;
  }> = [];
  const linked: string[] = [];
  const errors: string[] = [];
  const deps = {
    getUser: () =>
      new Promise<{ id: string } | null>((resolve, reject) =>
        userCalls.push({ resolve, reject }),
      ),
    link: (id: string, token: string) =>
      new Promise<{ error?: string }>((resolve, reject) =>
        linkCalls.push({ id, token, pending: { resolve, reject } }),
      ),
  };

  function Harness({
    id,
    token,
    enabled,
  }: {
    id: string;
    token: string;
    enabled: boolean;
  }) {
    useAnonymousAutoLink({
      anonymousId: id,
      anonymousToken: token,
      enabled,
      // A fresh object every render, as the page passes it.
      deps: { ...deps },
      onLinked: () => void linked.push(id),
      onError: (message) => void errors.push(message),
    });
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container as unknown as Element);
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  return {
    userCalls,
    linkCalls,
    linked,
    errors,
    settle,
    render: (
      props: { id?: string; token?: string; enabled?: boolean },
      strict = false,
    ) => {
      const element = (
        <Harness
          id={props.id ?? "guest-a"}
          token={props.token ?? "token-a"}
          enabled={props.enabled ?? true}
        />
      );
      return act(() =>
        root.render(strict ? <StrictMode>{element}</StrictMode> : element),
      );
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("anonymous auto-link lifecycle", () => {
  test("a delayed sign-in and link still finish and update the page once", async () => {
    const f = fixture();
    await f.render({});
    expect(f.userCalls).toHaveLength(1);
    await act(async () => f.userCalls[0].resolve({ id: "user-1" }));
    await f.settle();
    expect(f.linkCalls.map((c) => [c.id, c.token])).toEqual([
      ["guest-a", "token-a"],
    ]);
    await act(async () => f.linkCalls[0].pending.resolve({}));
    await f.settle();
    // The old effect cancelled itself when it set its own "attempted" state,
    // so this success never reached the page.
    expect(f.linked).toEqual(["guest-a"]);
    await f.unmount();
  });

  test("re-renders and new callback closures never send a second link", async () => {
    const f = fixture();
    await f.render({});
    await f.render({});
    await act(async () => f.userCalls[0].resolve({ id: "user-1" }));
    await f.settle();
    await f.render({});
    await act(async () => f.linkCalls[0].pending.resolve({}));
    await f.settle();
    await f.render({});
    expect(f.userCalls).toHaveLength(1);
    expect(f.linkCalls).toHaveLength(1);
    expect(f.linked).toEqual(["guest-a"]);
    await f.unmount();
  });

  test("StrictMode setup, cleanup, setup links exactly once", async () => {
    const f = fixture();
    await f.render({}, true);
    // The first setup was cleaned up before its write; only the second runs.
    for (const call of f.userCalls) {
      await act(async () => call.resolve({ id: "user-1" }));
    }
    await f.settle();
    expect(f.linkCalls).toHaveLength(1);
    await act(async () => f.linkCalls[0].pending.resolve({}));
    await f.settle();
    expect(f.linked).toEqual(["guest-a"]);
    await f.unmount();
  });

  test("unmounting before sign-in resolves never starts the write", async () => {
    const f = fixture();
    await f.render({});
    await f.unmount();
    await act(async () => f.userCalls[0].resolve({ id: "user-1" }));
    await f.settle();
    expect(f.linkCalls).toHaveLength(0);
    expect(f.linked).toEqual([]);
  });

  test("unmounting after the write was sent ignores the result locally", async () => {
    const f = fixture();
    await f.render({});
    await act(async () => f.userCalls[0].resolve({ id: "user-1" }));
    await f.settle();
    expect(f.linkCalls).toHaveLength(1);
    await f.unmount();
    await act(async () => f.linkCalls[0].pending.resolve({}));
    await f.settle();
    // Nothing on the page claims success or failure; the server result
    // stands and the next load reads it.
    expect(f.linked).toEqual([]);
    expect(f.errors).toEqual([]);
  });

  test("switching guest profiles drops the old scope before its write", async () => {
    const f = fixture();
    await f.render({ id: "guest-a", token: "token-a" });
    await f.render({ id: "guest-b", token: "token-b" });
    for (const call of f.userCalls) {
      await act(async () => call.resolve({ id: "user-1" }));
    }
    await f.settle();
    expect(f.linkCalls.map((c) => c.id)).toEqual(["guest-b"]);
    await act(async () => f.linkCalls[0].pending.resolve({}));
    await f.settle();
    expect(f.linked).toEqual(["guest-b"]);
    await f.unmount();
  });

  test("disabled, signed out, declared error and thrown error", async () => {
    const off = fixture();
    await off.render({ enabled: false });
    expect(off.userCalls).toHaveLength(0);
    await off.unmount();

    const signedOut = fixture();
    await signedOut.render({});
    await act(async () => signedOut.userCalls[0].resolve(null));
    await signedOut.settle();
    expect(signedOut.linkCalls).toHaveLength(0);
    expect(signedOut.errors).toEqual([]);
    await signedOut.unmount();

    const declared = fixture();
    await declared.render({});
    await act(async () => declared.userCalls[0].resolve({ id: "user-1" }));
    await declared.settle();
    await act(async () =>
      declared.linkCalls[0].pending.resolve({ error: "Already linked." }),
    );
    await declared.settle();
    expect(declared.errors).toEqual(["Already linked."]);
    expect(declared.linked).toEqual([]);
    await declared.unmount();

    const thrown = fixture();
    await thrown.render({});
    await act(async () => thrown.userCalls[0].reject(new Error("offline")));
    await thrown.settle();
    expect(thrown.errors).toEqual([AUTO_LINK_FAILURE_MESSAGE]);
    await thrown.unmount();
  });
});
