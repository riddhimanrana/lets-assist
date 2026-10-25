import { beforeEach, expect, mock, test } from "bun:test";
import { PDFDocument } from "pdf-lib";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SIGNUP = "22222222-2222-4222-8222-222222222222";
const DEFINITION = "33333333-3333-4333-8333-333333333333";
const GUEST = "44444444-4444-4444-8444-444444444444";
const SOURCE = `project_waivers/${PROJECT}/source.pdf`;
let required = true;
let signature: Record<string, unknown> | null;
let source: Uint8Array;
let pending = true;
let fieldPage = 9;
let beforeRpc: (() => void) | undefined;
const rpcs: { name: string; params: Record<string, unknown> }[] = [];
let downloads = 0;
let rpcOutcome: string | null = null;
const definition = () => ({
  id: DEFINITION,
  project_id: PROJECT,
  pdf_storage_path: SOURCE,
  pdf_public_url: null,
  signers: [{ role_key: "participant", required: true }],
  fields: [
    {
      field_key: "signature",
      field_type: "signature",
      signer_role_key: "participant",
      required: true,
      page_index: fieldPage,
      rect: { x: 100, y: 200, width: 200, height: 50 },
    },
  ],
});
const project = () => ({
  id: PROJECT,
  waiver_required: required,
  waiver_pdf_storage_path: SOURCE,
  waiver_definition_id: DEFINITION,
});
const client = {
  from(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "range"])
      chain[method] = () => chain;
    const settle = () => ({
      error: null,
      count: pending ? 1 : 0,
      data:
        table === "project_signups"
          ? pending
            ? [
                {
                  id: SIGNUP,
                  project_id: PROJECT,
                  projects: project(),
                  project: project(),
                  waiver_signatures: signature ? [signature] : [],
                  waiver_signature: signature,
                },
              ]
            : []
          : table === "waiver_signatures"
            ? signature
              ? [signature]
              : []
            : table === "projects"
              ? project()
              : definition(),
    });
    chain.then = (resolve: (value: unknown) => void) => resolve(settle());
    chain.maybeSingle = async () => {
      const result = settle();
      return {
        ...result,
        data: Array.isArray(result.data)
          ? (result.data[0] ?? null)
          : result.data,
      };
    };
    chain.single = chain.maybeSingle;
    return chain;
  },
  async rpc(name: string, params: Record<string, unknown>) {
    rpcs.push({ name, params });
    beforeRpc?.();
    const checkedWaivers = params.p_checked_waiver_signup_ids;
    const checkedSignatures = params.p_checked_signature_ids;
    const waived = required && pending ? [SIGNUP] : [];
    const signedIds = required && pending && signature ? [signature.id] : [];
    // Models the additional checked-proof fence. The draft only sends pending
    // IDs and therefore cannot distinguish these two preflight races.
    const proofChanged =
      Array.isArray(checkedWaivers) &&
      Array.isArray(checkedSignatures) &&
      (JSON.stringify(checkedWaivers) !== JSON.stringify(waived) ||
        JSON.stringify(checkedSignatures) !== JSON.stringify(signedIds));
    if (proofChanged)
      return {
        data: [
          {
            outcome: "pending_signups_changed",
            approved_count: 0,
            blocked_project_id: null,
            blocked_schedule_id: null,
          },
        ],
        error: null,
      };
    return {
      data: [
        {
          outcome: rpcOutcome ?? (pending ? "confirmed" : "already_confirmed"),
          approved_count: !rpcOutcome && pending ? 1 : 0,
          blocked_project_id: null,
          blocked_schedule_id: null,
        },
      ],
      error: null,
    };
  },
  storage: {
    from: () => ({
      download: async () => {
        downloads += 1;
        return {
          data: new Blob([source.slice()], { type: "application/pdf" }),
          error: null,
        };
      },
    }),
  },
};
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => client }));
const { confirmAnonymousSignupWithCapacity } =
  await import("./signup-capacity");
beforeEach(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  source = await pdf.save();
  pending = true;
  fieldPage = 9;
  beforeRpc = undefined;
  required = true;
  downloads = 0;
  rpcOutcome = null;
  rpcs.length = 0;
  signature = {
    id: "55555555-5555-4555-8555-555555555555",
    signup_id: SIGNUP,
    project_id: PROJECT,
    waiver_definition_id: DEFINITION,
    waiver_pdf_storage_path: SOURCE,
    waiver_pdf_url: null,
    signature_type: "multi-signer",
    signature_payload: {
      signers: [
        {
          role_key: "participant",
          method: "typed",
          data: "Fictional Volunteer",
          timestamp: "2026-10-11T12:00:00Z",
        },
      ],
      fields: {},
    },
    waiver_definition: definition(),
  };
});
test("confirmation refuses a legacy pending waiver with missing-page required signature", async () => {
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
  expect(rpcs).toHaveLength(0);
});
test("confirmation refuses missing evidence on a waiver-required pending signup", async () => {
  signature = null;
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
  expect(rpcs).toHaveLength(0);
});
test("a pending signup without a waiver requirement still confirms without fetching a PDF", async () => {
  signature = null;
  required = false;
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data?.outcome).toBe("confirmed");
  expect(downloads).toBe(0);
});
test("already confirmed profile with zero pending signups remains idempotent", async () => {
  pending = false;
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data?.outcome).toBe("already_confirmed");
  expect(downloads).toBe(0);
});

const placeable = () => ({
  ...definition(),
  fields: [{ ...definition().fields[0], page_index: 0 }],
});

test("a valid multi-signer waiver confirms through the checked transaction with its exact signup ids", async () => {
  signature = { ...signature, waiver_definition: placeable() };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data).toEqual({
    outcome: "confirmed",
    approvedCount: 1,
    blockedProjectId: null,
    blockedScheduleId: null,
  });
  expect(downloads).toBe(1);
  expect(rpcs).toEqual([
    {
      name: "confirm_anonymous_signup_with_capacity_checked",
      params: {
        p_anonymous_id: GUEST,
        p_checked_signup_ids: [SIGNUP],
        p_checked_waiver_signup_ids: [SIGNUP],
        p_checked_signature_ids: [signature?.id],
      },
    },
  ]);
});
test("a full signed copy confirms without reading the source or judging a placement", async () => {
  // The definition is unplaceable, but an uploaded signed copy is its own document.
  signature = {
    ...signature,
    signature_type: "upload",
    signature_payload: null,
    upload_storage_path: `signed-waivers/${PROJECT}/fictional.pdf`,
  };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data?.outcome).toBe("confirmed");
  expect(downloads).toBe(0);
  // An uploaded copy is still evidence the transaction must find unchanged.
  expect(rpcs[0].params).toMatchObject({
    p_checked_signup_ids: [SIGNUP],
    p_checked_waiver_signup_ids: [SIGNUP],
    p_checked_signature_ids: [signature?.id],
  });
});
test("a legacy single signature with no definition confirms when the fallback box fits", async () => {
  const landscape = await PDFDocument.create();
  landscape.addPage([792, 612]);
  source = await landscape.save();
  signature = {
    ...signature,
    waiver_definition_id: null,
    waiver_definition: null,
    signature_type: "typed",
    signature_payload: null,
    signature_text: "Fictional Volunteer",
    signed_at: "2026-10-11T12:00:00Z",
  };
  expect((await confirmAnonymousSignupWithCapacity(GUEST)).data?.outcome).toBe(
    "confirmed",
  );

  const tiny = await PDFDocument.create();
  tiny.addPage([100, 100]);
  source = await tiny.save();
  rpcs.length = 0;
  const refused = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(refused.data).toBeNull();
  expect(rpcs).toHaveLength(0);
});

test("legacy evidence without any immutable source cannot be confirmed using the current project PDF", async () => {
  signature = {
    ...signature,
    waiver_definition_id: null,
    waiver_definition: null,
    waiver_pdf_storage_path: null,
    waiver_pdf_url: null,
    signature_payload: null,
    signature_text: "Fictional legacy volunteer",
  };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
  expect(downloads).toBe(0);
  expect(rpcs).toHaveLength(0);
});

test("evidence with its source preserved by the immutable definition still confirms", async () => {
  signature = {
    ...signature,
    waiver_pdf_storage_path: null,
    waiver_pdf_url: null,
    waiver_definition: placeable(),
  };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data?.outcome).toBe("confirmed");
  expect(downloads).toBe(1);
});
test("an unreadable source refuses confirmation before the transaction", async () => {
  signature = { ...signature, waiver_definition: placeable() };
  source = Buffer.from("%PDF-1.7 fictional broken document");
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect((result.error as { code?: string }).code).toBe(
    "waiver_evidence_invalid",
  );
  expect(rpcs).toHaveLength(0);
});
test("zero pending signups forward an empty checked set", async () => {
  pending = false;
  await confirmAnonymousSignupWithCapacity(GUEST);
  expect(rpcs).toEqual([
    {
      name: "confirm_anonymous_signup_with_capacity_checked",
      params: {
        p_anonymous_id: GUEST,
        p_checked_signup_ids: [],
        p_checked_waiver_signup_ids: [],
        p_checked_signature_ids: [],
      },
    },
  ]);
});
test("a project without a waiver requirement forwards no waiver proof", async () => {
  required = false;
  await confirmAnonymousSignupWithCapacity(GUEST);
  expect(rpcs[0].params).toEqual({
    p_anonymous_id: GUEST,
    p_checked_signup_ids: [SIGNUP],
    p_checked_waiver_signup_ids: [],
    p_checked_signature_ids: [],
  });
});
test.each(["pending_signups_changed", "waiver_evidence_missing"])(
  "a %s outcome from the transaction is never reported as a confirmation",
  async (outcome) => {
    signature = { ...signature, waiver_definition: placeable() };
    rpcOutcome = outcome;
    const result = await confirmAnonymousSignupWithCapacity(GUEST);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as { code?: string }).code).toBe(
      outcome === "pending_signups_changed"
        ? "pending_signups_changed"
        : "waiver_evidence_invalid",
    );
  },
);
test("capacity outcomes from the transaction pass through unchanged", async () => {
  signature = { ...signature, waiver_definition: placeable() };
  rpcOutcome = "slot_full";
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data?.outcome).toBe("slot_full");
});
// PostgREST may return the to-one definition relation as an object or as an
// array. The shape is normalized, never guessed around.
test("a definition relation returned as a one-element array is the same definition", async () => {
  signature = { ...signature, waiver_definition: [placeable()] };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.error).toBeNull();
  expect(result.data?.outcome).toBe("confirmed");
  expect(downloads).toBe(1);

  // The same shape still judges the placement: this one is on a missing page.
  signature = { ...signature, waiver_definition: [definition()] };
  rpcs.length = 0;
  expect((await confirmAnonymousSignupWithCapacity(GUEST)).data).toBeNull();
  expect(rpcs).toHaveLength(0);
});
test.each<[string, () => unknown]>([
  ["is missing", () => null],
  ["is an empty array", () => []],
  ["holds more than one definition", () => [placeable(), placeable()]],
  [
    "is a different definition",
    () => ({ ...placeable(), id: "77777777-7777-4777-8777-777777777777" }),
  ],
])(
  "evidence that names a definition is refused when the relation %s",
  async (_name, relation) => {
    signature = { ...signature, waiver_definition: relation() };
    const result = await confirmAnonymousSignupWithCapacity(GUEST);
    expect(result.data).toBeNull();
    expect((result.error as { code?: string }).code).toBe(
      "waiver_evidence_invalid",
    );
    expect(rpcs).toHaveLength(0);
  },
);
test("evidence that names no definition is refused when a relation appears anyway", async () => {
  signature = {
    ...signature,
    waiver_definition_id: null,
    waiver_definition: [placeable()],
  };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect(rpcs).toHaveLength(0);
});
test("the retry and correction messages say what happened and never claim a confirmation", async () => {
  const invalid = await confirmAnonymousSignupWithCapacity(GUEST);
  expect((invalid.error as Error).message).toMatch(
    /^Your signup was not confirmed\./u,
  );
  expect((invalid.error as Error).message).toMatch(/organizer/u);
  expect((invalid.error as Error).message).toMatch(/sign it again/u);

  signature = { ...signature, waiver_definition: placeable() };
  rpcOutcome = "pending_signups_changed";
  const retry = await confirmAnonymousSignupWithCapacity(GUEST);
  expect((retry.error as Error).message).toMatch(/nothing was confirmed/u);
  expect((retry.error as Error).message).toMatch(/retry/u);
});
test("a waiver requirement enabled during preflight cannot approve unchecked invalid existing evidence", async () => {
  required = false;
  beforeRpc = () => {
    required = true;
  };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
});
test("evidence added or replaced after validation cannot be mistaken for the checked signature", async () => {
  fieldPage = 0;
  if (signature) signature.waiver_definition = definition();
  beforeRpc = () => {
    if (signature) signature.id = "66666666-6666-4666-8666-666666666666";
  };
  const result = await confirmAnonymousSignupWithCapacity(GUEST);
  expect(result.data).toBeNull();
  expect(result.error).toBeTruthy();
});
