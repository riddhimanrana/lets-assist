import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const DEFINITION = "22222222-2222-4222-8222-222222222222";
const SOURCE = `project_waivers/${PROJECT}/source.pdf`;
const URL = `https://fixture.supabase.co/storage/v1/object/public/waiver-uploads/${SOURCE}`;
const SIGNED_AT = "2026-10-11T12:00:00.000Z";
const calls: {
  kind: string;
  name?: string;
  params?: Record<string, unknown>;
}[] = [];
let source: Uint8Array;
let project: Record<string, unknown>;
let definition: Record<string, unknown>;
let afterDownload: (() => void) | undefined;
let canManage = true;
let latestSignature: Record<string, unknown> | null = null;
const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const client = {
  from(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order"])
      chain[method] = () => chain;
    const settle = async () => ({
      data:
        table === "projects"
          ? { ...project }
          : table === "waiver_signatures"
            ? latestSignature && { ...latestSignature }
            : { ...definition },
      error: null,
    });
    chain.single = settle;
    chain.maybeSingle = settle;
    return chain;
  },
  async rpc(name: string, params: Record<string, unknown>) {
    calls.push({ kind: "rpc", name, params });
    if (name !== "save_project_waiver_definition_version_checked")
      return { data: DEFINITION, error: null };
    if (
      params.p_expected_storage_path !== project.waiver_pdf_storage_path ||
      params.p_expected_definition_id !== project.waiver_definition_id ||
      params.p_expected_public_url !== project.waiver_pdf_url
    )
      return {
        data: null,
        error: { code: "40001", message: "Waiver changed" },
      };
    return { data: DEFINITION, error: null };
  },
  storage: {
    from(bucket: string) {
      return {
        async download(path: string) {
          calls.push({ kind: "download", name: `${bucket}/${path}` });
          const bytes = source.slice();
          afterDownload?.();
          return {
            data: new Blob([bytes], { type: "application/pdf" }),
            error: null,
          };
        },
        async upload() {
          calls.push({ kind: "upload" });
          return { error: null };
        },
        async remove() {
          calls.push({ kind: "remove" });
          return { error: null };
        },
        async copy(from: string) {
          calls.push({ kind: "copy", name: from });
          return { error: null };
        },
      };
    },
  },
};
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => client }));
mock.module("@/lib/supabase/auth-helpers", () => ({
  getAuthUser: async () => ({ user: { id: PROJECT }, error: null }),
}));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("next/headers", () => ({ headers: async () => new Map() }));
mock.module("@/app/projects/[id]/server/access", () => ({
  canCurrentUserManageProject: async () => canManage,
}));
const { saveWaiverDefinition } = await import("./waiver-definition");
const { prepareWaiverSignatureRecord } = await import("./waiver-persistence");
const rect = { x: 100, y: 200, width: 200, height: 50 };
const input = (pageIndex = 0, box = rect) => ({
  title: "Fictional waiver",
  signers: [
    {
      roleKey: "participant",
      label: "Participant",
      required: true,
      orderIndex: 0,
    },
  ],
  fields: {
    detected: {},
    custom: [
      {
        id: "signature",
        label: "Signature",
        fieldType: "signature",
        signerRoleKey: "participant",
        required: true,
        pageIndex,
        rect: box,
      },
    ],
  },
});
const recordField = (page = 0, box = rect) => ({
  field_key: "signature",
  field_type: "signature",
  required: true,
  signer_role_key: "participant",
  page_index: page,
  rect: box,
});
const prepare = () =>
  prepareWaiverSignatureRecord({
    projectId: PROJECT,
    evidenceKey: DEFINITION,
    signerName: "Fictional Volunteer",
    signerEmail: "fictional@local.test",
    waiverSignature: {
      signatureType: "multi-signer",
      definitionId: DEFINITION,
      payload: {
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
    },
  });
beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  source = await pdf.save();
  calls.length = 0;
  canManage = true;
  afterDownload = undefined;
  latestSignature = null;
  project = {
    waiver_definition_id: DEFINITION,
    waiver_pdf_storage_path: SOURCE,
    waiver_pdf_url: URL,
    waiver_allow_upload: true,
    waiver_disable_esignature: false,
  };
  definition = {
    id: DEFINITION,
    project_id: PROJECT,
    pdf_storage_path: SOURCE,
    pdf_public_url: URL,
    signers: [{ role_key: "participant", required: true }],
    fields: [recordField()],
  };
});
afterEach(() => {
  if (previousSupabaseUrl === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
});
test("definition save rejects a signature on a nonexistent actual PDF page before RPC", async () => {
  expect((await saveWaiverDefinition(PROJECT, input(1))).success).toBe(false);
  expect(calls.some((call) => call.kind === "rpc")).toBe(false);
});
test("definition save rejects an off-page required signature before RPC", async () => {
  expect(
    (await saveWaiverDefinition(PROJECT, input(0, { ...rect, x: 600 })))
      .success,
  ).toBe(false);
  expect(calls.some((call) => call.kind === "rpc")).toBe(false);
});
test("a readable valid definition uses a revision-checked save", async () => {
  expect((await saveWaiverDefinition(PROJECT, input())).success).toBe(true);
  expect(calls.find((call) => call.kind === "rpc")?.params).toMatchObject({
    p_expected_storage_path: SOURCE,
    p_expected_public_url: URL,
    p_expected_definition_id: DEFINITION,
  });
  expect(calls.find((call) => call.kind === "download")?.name).toBe(
    `waiver-uploads/${SOURCE}`,
  );
});
test("definition save refuses a source replaced after canonical bytes were loaded", async () => {
  afterDownload = () => {
    project.waiver_pdf_storage_path = `project_waivers/${PROJECT}/new.pdf`;
  };
  expect((await saveWaiverDefinition(PROJECT, input())).success).toBe(false);
});
test("definition save refuses a definition superseded after canonical bytes were loaded", async () => {
  afterDownload = () => {
    project.waiver_definition_id = "33333333-3333-4333-8333-333333333333";
  };
  expect((await saveWaiverDefinition(PROJECT, input())).success).toBe(false);
});
test("required field outside the visible crop box is refused", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).setCropBox(100, 100, 300, 400);
  source = await pdf.save();
  expect(
    (await saveWaiverDefinition(PROJECT, input(0, { ...rect, x: 10 }))).success,
  ).toBe(false);
});
test("signature preparation refuses canonical definition geometry on a missing page before upload", async () => {
  definition.fields = [recordField(4)];
  expect("error" in (await prepare())).toBe(true);
  expect(calls.some((call) => call.kind === "upload")).toBe(false);
});
test("signature preparation refuses canonical source mismatch rather than using client definition", async () => {
  definition.pdf_storage_path = `project_waivers/${PROJECT}/old.pdf`;
  expect("error" in (await prepare())).toBe(true);
  expect(calls.some((call) => call.kind === "upload")).toBe(false);
});
test("signature preparation refuses unreadable canonical PDF before upload", async () => {
  source = Buffer.from("%PDF-broken");
  expect("error" in (await prepare())).toBe(true);
  expect(calls.some((call) => call.kind === "upload")).toBe(false);
});
test("valid canonical signature preparation retains source and definition snapshots", async () => {
  const result = await prepare();
  expect("record" in result).toBe(true);
  if ("record" in result)
    expect(result.record).toMatchObject({
      waiver_definition_id: DEFINITION,
      waiver_pdf_storage_path: SOURCE,
    });
  expect(calls.some((call) => call.kind === "download")).toBe(true);
});
test("unauthorized definition save never loads source or saves", async () => {
  canManage = false;
  expect((await saveWaiverDefinition(PROJECT, input())).success).toBe(false);
  expect(calls).toHaveLength(0);
});
test("drawn signature with invalid canonical geometry uploads no evidence", async () => {
  definition.fields = [recordField(4)];
  const png = await sharp({
    create: { width: 20, height: 10, channels: 3, background: "black" },
  })
    .png()
    .toBuffer();
  const result = await prepareWaiverSignatureRecord({
    projectId: PROJECT,
    evidenceKey: DEFINITION,
    signerName: "Fictional Volunteer",
    signerEmail: "fictional@local.test",
    waiverSignature: {
      signatureType: "multi-signer",
      definitionId: DEFINITION,
      payload: {
        signers: [
          {
            role_key: "participant",
            method: "draw",
            data: `data:image/png;base64,${png.toString("base64")}`,
            timestamp: "2026-10-11T12:00:00Z",
          },
        ],
        fields: {},
      },
    },
  });
  expect("error" in result).toBe(true);
  expect(calls.some((call) => call.kind === "upload")).toBe(false);
});
test("required name field cannot disappear outside the canonical page", async () => {
  definition.fields = [
    recordField(),
    { ...recordField(2), field_key: "name", field_type: "name" },
  ];
  expect("error" in (await prepare())).toBe(true);
});
test("unrelated unsigned optional fields retain their established skip behavior", async () => {
  definition.fields = [
    recordField(),
    {
      ...recordField(2),
      required: false,
      signer_role_key: "optional",
      field_key: "optional-name",
      field_type: "name",
    },
  ];
  definition.signers = [
    { role_key: "participant", required: true },
    { role_key: "optional", required: false },
  ];
  expect("record" in (await prepare())).toBe(true);
});
test("a valid required placement on the second actual page stays accepted", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([792, 612]);
  source = await pdf.save();
  definition.fields = [recordField(1)];
  expect("record" in (await prepare())).toBe(true);
  expect((await saveWaiverDefinition(PROJECT, input(1))).success).toBe(true);
});
test("legacy synthetic single-signer short PDF remains usable before upload", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([792, 612]);
  source = await pdf.save();
  project.waiver_definition_id = null;
  const result = await prepareWaiverSignatureRecord({
    projectId: PROJECT,
    evidenceKey: DEFINITION,
    signerName: "Fictional Volunteer",
    signerEmail: "fictional@local.test",
    waiverSignature: {
      signatureType: "typed",
      signatureText: "Fictional Volunteer",
    },
  });
  expect("record" in result).toBe(true);
  expect(calls.some((call) => call.kind === "download")).toBe(true);
});
test("legacy URL-only project and current pinned definition can name the same trusted source", async () => {
  project.waiver_pdf_storage_path = null;
  expect("record" in (await prepare())).toBe(true);
});
test("legacy URL-only project with a different source is refused before upload", async () => {
  project.waiver_pdf_storage_path = null;
  project.waiver_pdf_url = URL.replace("source.pdf", "replacement.pdf");
  expect("error" in (await prepare())).toBe(true);
  expect(calls.some((call) => call.kind === "upload")).toBe(false);
});

const count = (kind: string) =>
  calls.filter((call) => call.kind === kind).length;
const dataUrl = (type: string, bytes: Uint8Array) =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const signaturePng = () =>
  sharp({ create: { width: 20, height: 10, channels: 3, background: "black" } })
    .png()
    .toBuffer();
const prepareWith = (
  waiverSignature: Parameters<
    typeof prepareWaiverSignatureRecord
  >[0]["waiverSignature"],
) =>
  prepareWaiverSignatureRecord({
    projectId: PROJECT,
    evidenceKey: DEFINITION,
    signerName: "Fictional Volunteer",
    signerEmail: "fictional@local.test",
    waiverSignature,
  });
// A minimal password-protected document. It parses, and reports encryption.
const encryptedPdf = () => {
  const key = "x".repeat(32);
  return Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj",
      "<< /Type /Catalog /Pages 2 0 R >>",
      "endobj",
      "2 0 obj",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "endobj",
      "3 0 obj",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
      "endobj",
      "4 0 obj",
      `<< /Filter /Standard /V 1 /R 2 /O (${key}) /U (${key}) /P -44 >>`,
      "endobj",
      "trailer",
      "<< /Root 1 0 R /Encrypt 4 0 R /Size 5 >>",
      "%%EOF",
    ].join("\n"),
  );
};

test("definition save refuses a malformed, zero-page, or encrypted source before RPC", async () => {
  const empty = await PDFDocument.create();
  const sources = [
    Buffer.from("%PDF-1.7 fictional broken document"),
    await empty.save({ addDefaultPage: false }),
    encryptedPdf(),
  ];
  for (const bytes of sources) {
    source = bytes;
    const result = await saveWaiverDefinition(PROJECT, input());
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  }
  expect(count("download")).toBe(sources.length);
  expect(count("rpc")).toBe(0);
});
test("definition save refuses a required name field outside the actual page", async () => {
  const definitionInput = input();
  definitionInput.fields.custom.push({
    id: "name",
    label: "Name",
    fieldType: "name",
    signerRoleKey: "participant",
    required: true,
    pageIndex: 0,
    rect: { x: 580, y: 700, width: 120, height: 20 },
  });
  expect((await saveWaiverDefinition(PROJECT, definitionInput)).success).toBe(
    false,
  );
  expect(count("rpc")).toBe(0);
});
test("definition save accepts a placement that only fits a landscape page", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([792, 612]);
  source = await pdf.save();
  const wide = { x: 560, y: 100, width: 200, height: 50 };
  expect((await saveWaiverDefinition(PROJECT, input(0, wide))).success).toBe(
    true,
  );
  // The same box runs off a portrait Letter page.
  const portrait = await PDFDocument.create();
  portrait.addPage([612, 792]);
  source = await portrait.save();
  expect((await saveWaiverDefinition(PROJECT, input(0, wide))).success).toBe(
    false,
  );
});
test("a stale save reports a retry, never a saved definition", async () => {
  afterDownload = () => {
    project.waiver_definition_id = "33333333-3333-4333-8333-333333333333";
  };
  const result = await saveWaiverDefinition(PROJECT, input());
  expect(result).toEqual({
    success: false,
    error:
      "The waiver document or its fields changed while you were saving. Reload the page and try again.",
  });
  expect(calls.find((call) => call.kind === "rpc")?.name).toBe(
    "save_project_waiver_definition_version_checked",
  );
});
test("a legacy drawn signature on a page too small for the fallback box uploads nothing", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  source = await pdf.save();
  project.waiver_definition_id = null;
  const result = await prepareWith({
    signatureType: "draw",
    signatureImageDataUrl: dataUrl("image/png", await signaturePng()),
  });
  expect("error" in result).toBe(true);
  expect(count("download")).toBe(1);
  expect(count("upload")).toBe(0);
});
test("a legacy drawn signature on a short page is stored once the fallback fits", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([420, 595]);
  source = await pdf.save();
  project.waiver_definition_id = null;
  const result = await prepareWith({
    signatureType: "draw",
    signatureImageDataUrl: dataUrl("image/png", await signaturePng()),
  });
  expect("record" in result).toBe(true);
  if ("record" in result) {
    expect(result.record).toMatchObject({
      waiver_definition_id: null,
      waiver_pdf_storage_path: SOURCE,
    });
    expect(result.record.signature_storage_path).toBeTruthy();
  }
  expect(count("upload")).toBe(1);
});
test("a drawn signature for a role the definition has no signature field for uploads nothing", async () => {
  const result = await prepareWith({
    signatureType: "draw",
    definitionId: DEFINITION,
    signatureImageDataUrl: dataUrl("image/png", await signaturePng()),
  });
  expect("record" in result).toBe(true);

  calls.length = 0;
  definition.signers = [{ role_key: "volunteer", required: true }];
  definition.fields = [{ ...recordField(), signer_role_key: "volunteer" }];
  expect(
    "error" in
      (await prepareWith({
        signatureType: "draw",
        definitionId: DEFINITION,
        signatureImageDataUrl: dataUrl("image/png", await signaturePng()),
      })),
  ).toBe(true);
  expect(count("upload")).toBe(0);
});
test("a definition the project has moved on from is refused before the source is read", async () => {
  project.waiver_definition_id = "33333333-3333-4333-8333-333333333333";
  expect("error" in (await prepare())).toBe(true);
  expect(count("download")).toBe(0);
  expect(count("upload")).toBe(0);
});
test("a full signed copy keeps its own rules and never needs a placement", async () => {
  definition.fields = [recordField(4)];
  definition.pdf_storage_path = `project_waivers/${PROJECT}/old.pdf`;
  const signedCopy = await PDFDocument.create();
  signedCopy.addPage([612, 792]);
  const result = await prepareWith({
    signatureType: "upload",
    definitionId: DEFINITION,
    uploadFileDataUrl: dataUrl("application/pdf", await signedCopy.save()),
  });
  expect("record" in result).toBe(true);
  if ("record" in result) {
    // New evidence names the project's current source, not a superseded one.
    expect(result.record).toMatchObject({ waiver_pdf_storage_path: SOURCE });
    expect(result.record.upload_storage_path).toBeTruthy();
  }
  expect(count("download")).toBe(0);
  expect(count("upload")).toBe(1);
});

const { prepareClonedAnonymousWaiverRecord } =
  await import("./waiver-persistence");
const GUEST = "44444444-4444-4444-8444-444444444444";
const reusableSignature = () => ({
  waiver_definition_id: DEFINITION,
  waiver_pdf_url: URL,
  waiver_pdf_storage_path: SOURCE,
  signer_name: "Fictional Volunteer",
  signer_email: "fictional@local.test",
  signature_type: "multi-signer",
  signature_text: null,
  signature_storage_path: null,
  upload_storage_path: null,
  form_data: null,
  signature_payload: {
    signers: [
      {
        role_key: "participant",
        method: "draw",
        data: "signatures/fictional.png",
        timestamp: SIGNED_AT,
      },
    ],
    fields: {},
  },
});
const clone = () =>
  prepareClonedAnonymousWaiverRecord({
    projectId: PROJECT,
    anonymousId: GUEST,
    evidenceKey: DEFINITION,
  });

test("guest reuse copies evidence that still matches the current waiver", async () => {
  latestSignature = reusableSignature();
  const result = await clone();
  expect("record" in result).toBe(true);
  if ("record" in result)
    expect(result.record).toMatchObject({
      waiver_definition_id: DEFINITION,
      waiver_pdf_storage_path: SOURCE,
    });
  expect(count("download")).toBe(1);
  expect(
    calls.filter((call) => call.kind === "copy").map((call) => call.name),
  ).toEqual(["signatures/fictional.png"]);
});
test("guest reuse of a superseded definition is refused before anything is copied", async () => {
  latestSignature = reusableSignature();
  project.waiver_definition_id = "33333333-3333-4333-8333-333333333333";
  expect("error" in (await clone())).toBe(true);
  expect(count("copy")).toBe(0);
  expect(count("download")).toBe(0);
});
test("guest reuse of a replaced source is refused before anything is copied", async () => {
  latestSignature = reusableSignature();
  project.waiver_pdf_storage_path = `project_waivers/${PROJECT}/new.pdf`;
  project.waiver_pdf_url = URL.replace("source.pdf", "new.pdf");
  expect("error" in (await clone())).toBe(true);
  expect(count("copy")).toBe(0);
});
test("guest reuse of evidence that no longer fits its page is refused before anything is copied", async () => {
  latestSignature = reusableSignature();
  definition.fields = [recordField(4)];
  expect("error" in (await clone())).toBe(true);
  expect(count("copy")).toBe(0);
});
