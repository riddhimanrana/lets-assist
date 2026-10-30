/**
 * The real AnonymousSignupClient on the minimal test DOM, re-rendered with a
 * different guest profile in the same React position, as App Router does
 * when only the [id] param changes. Child sections are stubs that print the
 * state they receive; all server actions and auth are mocked and never run.
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";

import {
  installMinimalDom,
  type MinimalElement,
} from "@/tests/support/minimal-dom";

const { document } = installMinimalDom();

const unexpected = () => {
  throw new Error("No server action may run in this test");
};
mock.module("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/link", () => ({
  default: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
mock.module("sonner", () => ({ toast: { success() {}, error() {} } }));
mock.module("@/lib/supabase/client", () => ({ createClient: unexpected }));
mock.module("./actions", () => ({
  linkAnonymousToAuthenticatedAccount: unexpected,
}));
mock.module("@/app/projects/[id]/actions", () => ({
  cancelSignup: unexpected,
  getAnonymousWaiverSignatureMeta: unexpected,
  getWaiverDownloadUrl: unexpected,
}));
mock.module("@/components/icons/animated", () => ({
  CompassIcon: () => null,
  useAnimatedIcon: () => ({ ref: null, triggerProps: {} }),
}));
mock.module("./_components/LinkAccountSection", () => ({
  LinkAccountSection: (props: { linkStatus: string; id: string }) => (
    <p data-link-status={props.linkStatus}>
      {props.id}:{props.linkStatus}
    </p>
  ),
}));
mock.module("./_components/SlotRow", () => ({
  SlotRow: ({ slot }: { slot: { project_signup_id: string } }) => (
    <li>{slot.project_signup_id}</li>
  ),
}));
mock.module("./_components/CancelSlotDialog", () => ({
  CancelSlotDialog: () => null,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: AnonymousSignupClient } =
  await import("./AnonymousSignupClient");

type Props = Parameters<typeof AnonymousSignupClient>[0];
const guest = (id: string, linked: boolean): Props =>
  ({
    id,
    accessToken: `token-${id}`,
    name: `Guest ${id}`,
    email: `${id}@example.test`,
    phone_number: null,
    confirmed_at: "2026-10-01T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
    project: {
      id: "project-1",
      title: "Fictional cleanup",
      waiver_required: false,
      status: "upcoming",
    },
    isProjectCancelled: false,
    slots: [{ project_signup_id: `slot-${id}` }],
    linkedUserId: linked ? "user-1" : null,
    linkedAccountEmail: linked ? `${id}@example.test` : null,
    linkedAccountVerified: linked,
    certificateIds: {},
    anonymousPluginCards: [],
    anonymousPluginBehavior: null,
  }) as unknown as Props;

async function switchGuests(useKey: boolean) {
  const container = document.createElement("div");
  const root = createRoot(container as unknown as Element);
  const show = (props: Props) =>
    act(() =>
      root.render(
        useKey ? (
          <AnonymousSignupClient key={props.id} {...props} />
        ) : (
          <AnonymousSignupClient {...props} />
        ),
      ),
    );
  await show(guest("guest-a", true));
  await show(guest("guest-b", false));
  const status = (container as unknown as MinimalElement)
    .find((e) => e.hasAttribute("data-link-status"))
    ?.getAttribute("data-link-status");
  await act(() => root.unmount());
  return status;
}

describe("guest profile identity", () => {
  test("without an identity key, one guest's link state carries into the next", async () => {
    // This is the hazard: same component, same position, new props.
    expect(await switchGuests(false)).toBe("linked");
  });

  test("keyed by guest ID, the next guest starts from its own state", async () => {
    expect(await switchGuests(true)).toBe("unlinked");
  });

  test("source-only: the server page keys the client by the guest ID", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(page.replace(/\s+/gu, " ")).toMatch(
      /<AnonymousSignupClient (\/\/[^<]*?)?key=\{signupId\} id=\{signupId\}/u,
    );
  });
});
