import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { enqueueOrphanedWaiverEvidence } from "./cleanup-storage";
import { resolveWaiverSignerIdentity } from "./signer-identity";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const orchestration = read("app/projects/[id]/server/signup.ts");
const registeredFlow = read("app/projects/[id]/server/signup-registered.ts");
const guestFlow = read("app/projects/[id]/server/signup-anonymous.ts");
const persistence = read("app/projects/[id]/server/shared.ts");
const evidence = read("app/projects/[id]/server/waiver-persistence.ts");
const signupModules = [
  orchestration,
  registeredFlow,
  guestFlow,
  persistence,
  evidence,
].join("\n");

describe("waiver signer identity", () => {
  test("a session actor signs under the verified session email", () => {
    expect(
      resolveWaiverSignerIdentity({
        signerNameInput: "Someone Else",
        signerEmailInput: "attacker@allowed-domain.test",
        sessionEmail: "member@school.test",
        sessionFullName: "Real Member",
        isSessionActor: true,
      }),
    ).toEqual({
      signerName: "Someone Else",
      signerEmail: "member@school.test",
    });
  });

  test("a session actor with no session email cannot sign at all", () => {
    expect(
      resolveWaiverSignerIdentity({
        signerEmailInput: "attacker@allowed-domain.test",
        guestEmail: "guest@allowed-domain.test",
        sessionEmail: "",
        isSessionActor: true,
      }),
    ).toBeNull();
  });

  test("a guest signs under the address that passed the guest gates", () => {
    expect(
      resolveWaiverSignerIdentity({
        signerEmailInput: "other@elsewhere.test",
        guestName: "Guest Volunteer",
        guestEmail: "guest@allowed-domain.test",
        isSessionActor: false,
      }),
    ).toEqual({
      signerName: "Guest Volunteer",
      signerEmail: "guest@allowed-domain.test",
    });
  });
});

describe("uncommitted waiver evidence", () => {
  test("queues only real storage paths, deduplicated", async () => {
    const batches: { bucket_id: string; object_path: string }[][] = [];
    const result = await enqueueOrphanedWaiverEvidence(
      async (rows) => {
        batches.push(rows);
        return { error: null };
      },
      [
        "signatures/a.png",
        "signatures/a.png",
        "data:image/png;base64,inline",
        "https://example.test/remote.png",
        "",
      ],
    );

    expect(result).toEqual({ enqueued: 1 });
    expect(batches).toEqual([
      [{ bucket_id: "waiver-signatures", object_path: "signatures/a.png" }],
    ]);
  });

  test("reports a queue failure without throwing", async () => {
    const result = await enqueueOrphanedWaiverEvidence(
      async () => ({ error: { message: "boom" } }),
      ["signatures/a.png"],
    );

    expect(result.enqueued).toBe(0);
    expect(result.error).toBe(
      "Failed to queue uncommitted waiver evidence for cleanup",
    );
  });

  test("does nothing when there is no evidence to release", async () => {
    let called = false;
    const result = await enqueueOrphanedWaiverEvidence(async () => {
      called = true;
      return { error: null };
    }, []);

    expect(result).toEqual({ enqueued: 0 });
    expect(called).toBe(false);
  });
});

describe("signup actor derivation", () => {
  test("the actor comes from the session before any gate runs", () => {
    const authCall = "const { user } = await getAuthUser();";
    const authIndex = orchestration.indexOf(authCall);
    expect(authIndex).toBeGreaterThan(0);
    // Exactly one session read, so no later gate can re-derive a different actor.
    expect(
      orchestration.indexOf("getAuthUser()", authIndex + authCall.length),
    ).toBe(-1);
    expect(orchestration).toMatch(
      /const isAnonymous = !user && hasGuestPayload;/u,
    );
    expect(authIndex).toBeLessThan(
      orchestration.indexOf("getProject(projectId)"),
    );
  });

  test("a signed-in caller carrying a guest payload is refused", () => {
    expect(orchestration).toMatch(/if \(user && hasGuestPayload\) \{/u);
    const refusal = orchestration.slice(
      orchestration.indexOf("if (user && hasGuestPayload) {"),
    );
    expect(refusal.slice(0, 500)).toMatch(/return \{\s*error:/u);
  });

  test("the domain gate measures a session actor against verified identity", () => {
    const gateStart = orchestration.indexOf("--- Domain Restriction Check ---");
    const gateEnd = orchestration.indexOf(
      'event_type === "multiDay"',
      gateStart,
    );
    const gate = orchestration.slice(gateStart, gateEnd);

    expect(gate).toMatch(/if \(user\) \{/u);
    expect(gate).toMatch(/checkDomain\(user\.email\)/u);
    expect(gate).toMatch(/\.not\("verified_at", "is", null\)/u);
    // The guest address is only ever consulted when there is no session.
    expect(gate).toMatch(
      /\} else if \(isAnonymous && anonymousData\?\.email\)/u,
    );
    const guestBranch = gate.slice(gate.indexOf("} else if (isAnonymous"));
    expect(gate.indexOf("anonymousData")).toBeGreaterThan(
      gate.indexOf("if (user) {"),
    );
    expect(guestBranch).toContain("anonymousData.email");
  });
});

describe("signup persistence boundary", () => {
  test("every signup write goes through the one atomic transaction", () => {
    expect(persistence).toMatch(/"insert_project_signup_with_waiver"/u);
    expect(persistence).toMatch(/p_waiver: waiver/u);
    expect(persistence).toMatch(/p_anonymous_profile: anonymousProfile/u);
    expect(registeredFlow).toMatch(/insertProjectSignupAtomically\(/u);
    expect(guestFlow).toMatch(/insertProjectSignupAtomically\(/u);
  });

  test("no compensating delete remains anywhere in the signup path", () => {
    expect(signupModules).not.toMatch(
      /\.from\("project_signups"\)\s*\n?\s*\.delete\(\)/u,
    );
    expect(signupModules).not.toMatch(
      /\.from\("anonymous_signups"\)\s*\n?\s*\.delete\(\)/u,
    );
    expect(signupModules).not.toContain("createdNewAnonymousProfile");
  });

  test("the guest identity is created by the signup transaction itself", () => {
    expect(guestFlow).not.toMatch(
      /\.from\("anonymous_signups"\)\s*\n?\s*\.insert\(/u,
    );
    expect(guestFlow).toMatch(/anonymousProfile: \{/u);
    expect(guestFlow).toMatch(
      /createdAnonymousSignupId = insertedProjectSignup\.anonymousId;/u,
    );
  });

  test("waiver evidence is prepared but only ever written by the transaction", () => {
    expect(evidence).toMatch(
      /export async function prepareWaiverSignatureRecord/u,
    );
    expect(evidence).toMatch(
      /export async function prepareClonedAnonymousWaiverRecord/u,
    );
    expect(evidence).not.toMatch(
      /\.from\("waiver_signatures"\)\s*\n?\s*\.insert\(/u,
    );
    expect(evidence).toMatch(/signature_storage_path: signatureStoragePath/u);
    expect(evidence).toMatch(/upload_storage_path: uploadStoragePath/u);
    expect(evidence).toMatch(
      /signature_storage_path: clonedSignatureStoragePath/u,
    );
  });

  test("uncommitted evidence is released on every refusal path", () => {
    const releases = signupModules.match(
      /releaseUncommittedWaiverEvidence\(/gu,
    );
    expect(releases?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(persistence).toMatch(/waiver_storage_deletion_queue/u);
  });

  test("refusal outcomes map to messages that leak no provider text", () => {
    for (const outcome of [
      "waiver_required",
      "project_unpublished",
      "conflicting_identity",
      "identity_conflict",
    ]) {
      expect(persistence).toContain(`code === "${outcome}"`);
    }
    const messageBlock = persistence.slice(
      persistence.indexOf("export function getProjectSignupInsertErrorMessage"),
      persistence.indexOf("export type WaiverSignatureRecord"),
    );
    expect(messageBlock).not.toMatch(
      /error\.message|pgError\.message|details/u,
    );
  });
});
