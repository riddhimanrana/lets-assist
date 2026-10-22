import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const uploads: { bytes: Buffer; type: string }[] = [];
const client = {
  from() {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "update", "limit"])
      chain[method] = () => chain;
    chain.maybeSingle = async () => ({
      data: { workflow_status: "draft", waiver_required: true },
      error: null,
    });
    chain.then = (resolve: (result: unknown) => void) =>
      resolve({ error: null });
    return chain;
  },
  storage: {
    from: () => ({
      upload: async (
        _path: string,
        bytes: Buffer,
        options: { contentType: string },
      ) => {
        uploads.push({ bytes, type: options.contentType });
        return { error: null };
      },
      getPublicUrl: () => ({
        data: { publicUrl: "https://fixture.invalid/waiver.pdf" },
      }),
      remove: async () => ({ error: null }),
    }),
  },
};
mock.module("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));
mock.module("@/lib/supabase/admin", () => ({ getAdminClient: () => client }));
mock.module("next/headers", () => ({ headers: async () => new Map() }));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/app/projects/[id]/server/access", () => ({
  canCurrentUserManageProject: async () => true,
}));
const { uploadWaiverAsset } = await import("./waiver-persistence");
const { uploadProjectWaiverPdf } = await import("./waiver-assets");
const { uploadWaiverPdf } = await import("@/app/projects/create/server/assets");
const dataUrl = (type: string, bytes: Uint8Array) =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const projectId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  uploads.length = 0;
});

describe("waiver uploads validate actual file bytes before Storage", () => {
  for (const [name, upload] of [
    ["edit", uploadProjectWaiverPdf],
    ["create", uploadWaiverPdf],
  ] as const) {
    test(`${name} refuses an unreadable source`, async () => {
      const result = await upload(
        projectId,
        dataUrl("application/pdf", Buffer.from("fictional invalid PDF")),
        "fixture.pdf",
      );
      expect(result.error).toBeTruthy();
      expect(uploads).toHaveLength(0);
    });
    test(`${name} retains the bytes of a valid source`, async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage([612, 792]);
      const bytes = await pdf.save();
      const result = await upload(
        projectId,
        dataUrl("application/pdf", bytes),
        "fixture.pdf",
      );
      expect(result.success).toBe(true);
      expect(uploads[0].bytes).toEqual(Buffer.from(bytes));
    });
  }
  test("both source upload paths refuse malformed data URLs, wrong MIME and empty files", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    for (const upload of [uploadProjectWaiverPdf, uploadWaiverPdf]) {
      for (const input of [
        "",
        "data:application/pdf;base64,",
        "data:application/pdf;base64,AAAA!",
        "data:application/pdf;base64,YQ",
        dataUrl("image/png", bytes),
      ]) {
        expect(
          (await upload(projectId, input, "fixture.pdf")).error,
        ).toBeTruthy();
      }
    }
    expect(uploads).toHaveLength(0);
  });
  test("both source upload paths refuse encrypted documents before Storage", async () => {
    const key = "x".repeat(32);
    const bytes = Buffer.from(
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
    for (const upload of [uploadProjectWaiverPdf, uploadWaiverPdf]) {
      expect(
        (
          await upload(
            projectId,
            dataUrl("application/pdf", bytes),
            "fixture.pdf",
          )
        ).error,
      ).toContain("password");
    }
    expect(uploads).toHaveLength(0);
  });
  test("signature uploads reject truncated images and size overflow before Storage", async () => {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "black" },
    })
      .png()
      .toBuffer();
    const truncated = await uploadWaiverAsset({
      bucket: "waiver-signatures",
      dataUrl: dataUrl("image/png", bytes.subarray(0, bytes.length - 20)),
      fileName: "fixture",
      maxBytes: 2 * 1024 * 1024,
      allowedTypes: ["image/png"],
    });
    expect(truncated.reason).toBe("invalid");
    const oversized = await uploadWaiverAsset({
      bucket: "waiver-signatures",
      dataUrl: dataUrl("image/png", Buffer.alloc(2 * 1024 * 1024 + 1)),
      fileName: "fixture",
      maxBytes: 2 * 1024 * 1024,
      allowedTypes: ["image/png"],
    });
    expect(oversized.reason).toBe("size");
    expect(uploads).toHaveLength(0);
  });
  test("refuses undecodable signature images and unreadable signed uploads", async () => {
    for (const type of ["application/pdf", "image/png", "image/jpeg"]) {
      const result = await uploadWaiverAsset({
        bucket: "waiver-signatures",
        dataUrl: dataUrl(type, Buffer.from("fictional invalid file")),
        fileName: "fixture",
        maxBytes: 10 * 1024 * 1024,
        allowedTypes: [type],
      });
      expect(result.reason).toBe("invalid");
    }
    expect(uploads).toHaveLength(0);
  });
  test("refuses image bytes that do not match the declared MIME", async () => {
    const jpg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "black" },
    })
      .jpeg()
      .toBuffer();
    const result = await uploadWaiverAsset({
      bucket: "waiver-signatures",
      dataUrl: dataUrl("image/png", jpg),
      fileName: "fixture",
      maxBytes: 2 * 1024 * 1024,
      allowedTypes: ["image/png"],
    });
    expect(result.reason).toBe("invalid");
    expect(uploads).toHaveLength(0);
  });
  test("a readable high-resolution signed-page image stays accepted within the byte limit", async () => {
    const bytes = await sharp({
      create: { width: 5000, height: 4000, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    const result = await uploadWaiverAsset({
      bucket: "waiver-signatures",
      dataUrl: dataUrl("image/png", bytes),
      fileName: "fictional signed page",
      maxBytes: 2 * 1024 * 1024,
      allowedTypes: ["image/png"],
    });
    expect(result.error).toBeUndefined();
    expect(uploads[0].bytes).toEqual(bytes);
  });
  test("stores valid PNG and JPEG signature images without rewriting evidence", async () => {
    for (const type of ["image/png", "image/jpeg"]) {
      const image = sharp({
        create: { width: 2, height: 2, channels: 3, background: "black" },
      });
      const bytes = await (
        type === "image/png" ? image.png() : image.jpeg()
      ).toBuffer();
      const result = await uploadWaiverAsset({
        bucket: "waiver-signatures",
        dataUrl: dataUrl(type, bytes),
        fileName: "fixture",
        maxBytes: 2 * 1024 * 1024,
        allowedTypes: [type],
      });
      expect(result.error).toBeUndefined();
      expect(uploads.at(-1)?.bytes).toEqual(bytes);
    }
  });
});
