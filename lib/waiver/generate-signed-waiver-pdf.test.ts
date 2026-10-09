import { describe, expect, test } from "bun:test";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";

import {
  SignedWaiverPdfError,
  UNRENDERABLE_TEXT_NOTE,
  formatSignedAt,
  generateSignedWaiverPdf,
  isEncryptedPdf,
  toRenderableText,
  type PdfGenerationOptions,
} from "./generate-signed-waiver-pdf";

type Field = NonNullable<PdfGenerationOptions["definition"]["fields"]>[number];

async function blankPdf(pageCount = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([612, 792]);
  }
  return document.save();
}

/** Every string the renderer drew on a page, decoded from its content streams. */
async function drawnText(pdf: Buffer, pageIndex = 0): Promise<string[]> {
  const document = await PDFDocument.load(pdf);
  const contents = document.getPages()[pageIndex].node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => document.context.lookup(ref))
      : [contents];

  const drawn: string[] = [];
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) continue;
    const source = Buffer.from(decodePDFRawStream(stream).decode()).toString(
      "latin1",
    );
    for (const match of source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      drawn.push(Buffer.from(match[1], "hex").toString("latin1"));
    }
  }
  return drawn;
}

/** The smallest document a PDF parser reports as password protected. */
function encryptedPdfFixture(): Uint8Array {
  const key = "x".repeat(32);
  return new TextEncoder().encode(
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
      "",
    ].join("\n"),
  );
}

const signatureField = (overrides: Partial<Field> = {}): Field => ({
  field_key: "volunteer_signature",
  field_type: "signature",
  page_index: 0,
  rect: { x: 72, y: 500, width: 240, height: 48 },
  signer_role_key: "volunteer",
  ...overrides,
});

const typedSigner = (data: string) => ({
  role_key: "volunteer",
  method: "typed" as const,
  data,
  timestamp: "2026-03-01T20:15:00.000Z",
});

async function winAnsi(): Promise<Set<number>> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  return new Set(font.getCharacterSet());
}

describe("toRenderableText", () => {
  test("leaves text the font can encode untouched", async () => {
    expect(toRenderableText("Zoë O'Brien-Müller", await winAnsi())).toEqual({
      text: "Zoë O'Brien-Müller",
      substituted: false,
    });
  });

  test("reduces Polish and Vietnamese letters to their base letters", async () => {
    const encodable = await winAnsi();
    expect(toRenderableText("Wałęsa Łukasz", encodable)).toEqual({
      text: "Walesa Lukasz",
      substituted: true,
    });
    expect(toRenderableText("Nguyễn Thị Hương", encodable)).toEqual({
      text: "Nguyen Thi Huong",
      substituted: true,
    });
  });

  test("replaces scripts with no Latin base letter", async () => {
    const encodable = await winAnsi();
    expect(toRenderableText("王小明", encodable)).toEqual({
      text: "???",
      substituted: true,
    });
    const hindi = toRenderableText("राहुल", encodable);
    expect(hindi.substituted).toBe(true);
    expect(hindi.text).toMatch(/^\?+$/);
  });

  test("normalizes spacing characters without flagging a substitution", async () => {
    const narrowNoBreakSpace = String.fromCodePoint(0x202f);
    const thinSpace = String.fromCodePoint(0x2009);
    expect(
      toRenderableText(
        `3:04${narrowNoBreakSpace}PM\tPST${thinSpace}x`,
        await winAnsi(),
      ),
    ).toEqual({ text: "3:04 PM PST x", substituted: false });
  });

  test("accepts values that are not strings", async () => {
    const encodable = await winAnsi();
    expect(toRenderableText(42, encodable).text).toBe("42");
    expect(toRenderableText(null, encodable).text).toBe("");
  });
});

describe("formatSignedAt", () => {
  test("renders in the project's zone with its abbreviation", () => {
    expect(formatSignedAt("2026-03-01T20:15:00.000Z", "America/New_York")).toBe(
      "Mar 1, 2026 at 3:15 PM EST",
    );
    expect(
      formatSignedAt("2026-07-01T20:15:00.000Z", "America/Los_Angeles"),
    ).toBe("Jul 1, 2026 at 1:15 PM PDT");
  });

  test("falls back to UTC, labelled, when the zone is missing or unknown", () => {
    for (const zone of [undefined, null, "", "Mars/Olympus_Mons"]) {
      expect(formatSignedAt("2026-03-01T20:15:00.000Z", zone)).toBe(
        "Mar 1, 2026 at 8:15 PM UTC",
      );
    }
  });

  test("returns null for a timestamp that is not a date", () => {
    expect(formatSignedAt("not a date", "UTC")).toBeNull();
    expect(formatSignedAt(undefined, "UTC")).toBeNull();
  });
});

describe("generateSignedWaiverPdf", () => {
  test.each([
    ["Chinese", "王小明"],
    ["Polish", "Wałęsa Łukasz"],
    ["Vietnamese", "Nguyễn Thị Hương"],
    ["Hindi", "राहुल शर्मा"],
  ])("renders a typed %s signature without throwing", async (_name, value) => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: { id: "definition", fields: [signatureField()] },
      signaturePayload: { signers: [typedSigner(value)], fields: {} },
      timeZone: "America/New_York",
    });

    const drawn = await drawnText(pdf);
    expect(drawn).toContain("Signed: Mar 1, 2026 at 3:15 PM EST");
    // The page says that the printed name is not the name that was typed.
    expect(drawn.join(" ")).toContain(
      UNRENDERABLE_TEXT_NOTE.split(".")[0].slice(0, 20),
    );
  });

  test("a name the font can encode gets no note", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: { id: "definition", fields: [signatureField()] },
      signaturePayload: { signers: [typedSigner("Alex Johnson")], fields: {} },
    });

    const drawn = await drawnText(pdf);
    expect(drawn).toContain("Alex Johnson");
    expect(drawn).toContain("Signed: Mar 1, 2026 at 8:15 PM UTC");
    expect(drawn.join(" ")).not.toContain("could not be shown");
  });

  test("renders a non-Latin name in a name field", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: {
        id: "definition",
        fields: [
          signatureField(),
          {
            field_key: "full_name",
            field_type: "name",
            page_index: 0,
            rect: { x: 72, y: 600, width: 240, height: 20 },
            signer_role_key: "volunteer",
          },
        ],
      },
      signaturePayload: {
        signers: [typedSigner("Alex Johnson")],
        fields: { full_name: "Nguyễn Thị Hương" },
      },
    });

    expect((await drawnText(pdf)).join(" ")).toContain("Nguyen Thi Huong");
  });

  test("skips fields on a page the document does not have", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(1),
      definition: {
        id: "definition",
        fields: [
          signatureField({ page_index: 7 }),
          {
            field_key: "off_page",
            field_type: "text",
            page_index: 7,
            rect: { x: 72, y: 600, width: 240, height: 20 },
            signer_role_key: null,
          },
          {
            field_key: "negative_page",
            field_type: "text",
            page_index: -1,
            rect: { x: 72, y: 560, width: 240, height: 20 },
            signer_role_key: null,
          },
          {
            field_key: "on_page",
            field_type: "text",
            page_index: 0,
            rect: { x: 72, y: 520, width: 240, height: 20 },
            signer_role_key: null,
          },
        ],
      },
      signaturePayload: {
        signers: [typedSigner("Alex Johnson")],
        fields: {
          off_page: "Hidden one",
          negative_page: "Hidden two",
          on_page: "Visible",
        },
      },
    });

    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(1);
    const drawn = (await drawnText(pdf)).join(" ");
    expect(drawn).toContain("Visible");
    expect(drawn).not.toContain("Hidden");
    expect(drawn).not.toContain("Alex Johnson");
  });

  test("draws address and initial values", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: {
        id: "definition",
        fields: [
          {
            field_key: "home_address",
            field_type: "address",
            page_index: 0,
            rect: { x: 72, y: 600, width: 300, height: 48 },
            signer_role_key: "volunteer",
          },
          {
            field_key: "initials",
            field_type: "initial",
            page_index: 0,
            rect: { x: 72, y: 540, width: 60, height: 20 },
            signer_role_key: "volunteer",
          },
        ],
      },
      signaturePayload: {
        signers: [],
        fields: { home_address: "123 Main St", initials: "AJ" },
      },
    });

    const drawn = (await drawnText(pdf)).join(" ");
    expect(drawn).toContain("123 Main St");
    expect(drawn).toContain("AJ");
  });

  test("reports an unreadable source with a typed error", async () => {
    const attempt = generateSignedWaiverPdf({
      sourcePdfBytes: new TextEncoder().encode("this is not a pdf"),
      definition: { id: "definition", fields: [] },
      signaturePayload: { signers: [], fields: {} },
    });

    await expect(attempt).rejects.toBeInstanceOf(SignedWaiverPdfError);
    await expect(attempt).rejects.toMatchObject({ code: "unreadable_source" });
  });

  test("reports a password protected source with a typed error", async () => {
    expect(await isEncryptedPdf(encryptedPdfFixture())).toBe(true);
    await expect(
      generateSignedWaiverPdf({
        sourcePdfBytes: encryptedPdfFixture(),
        definition: { id: "definition", fields: [] },
        signaturePayload: { signers: [], fields: {} },
      }),
    ).rejects.toMatchObject({ code: "encrypted_source" });
  });

  test("a readable, unprotected PDF is not reported as encrypted", async () => {
    expect(await isEncryptedPdf(await blankPdf())).toBe(false);
    expect(await isEncryptedPdf(new TextEncoder().encode("junk"))).toBe(false);
  });
});
