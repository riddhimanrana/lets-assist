import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
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

/** The decoded content streams of one page. */
async function pageContent(pdf: Buffer, pageIndex = 0): Promise<string> {
  const document = await PDFDocument.load(pdf);
  const contents = document.getPages()[pageIndex].node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => document.context.lookup(ref))
      : [contents];

  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) =>
      Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"),
    )
    .join("\n");
}

/**
 * Every string drawn with the standard font, decoded from the content streams.
 * Text drawn with an embedded font is glyph ids, so it does not read as text.
 */
async function drawnText(pdf: Buffer, pageIndex = 0): Promise<string[]> {
  const source = await pageContent(pdf, pageIndex);
  return Array.from(source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g), (match) =>
    Buffer.from(match[1], "hex").toString("latin1"),
  );
}

/** Where each glyph of an embedded font was placed, in drawing order. */
async function glyphPositions(
  pdf: Buffer,
): Promise<{ x: number; y: number }[]> {
  const source = await pageContent(pdf);
  return Array.from(
    source.matchAll(
      /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<[0-9A-Fa-f]{4}>\s*Tj/g,
    ),
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );
}

/** The font programs embedded in a PDF. The standard font embeds none. */
async function embeddedFonts(
  pdf: Buffer,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const document = await PDFDocument.load(pdf);
  const fonts: { name: string; bytes: Uint8Array }[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of("Type")) !== PDFName.of("FontDescriptor")) {
      continue;
    }
    const program = object.lookup(PDFName.of("FontFile2"));
    if (!(program instanceof PDFRawStream)) continue;
    fonts.push({
      name: String(object.get(PDFName.of("FontName"))),
      bytes: decodePDFRawStream(program).decode(),
    });
  }
  return fonts;
}

const NOTE_OPENING = UNRENDERABLE_TEXT_NOTE.slice(0, 20);

/**
 * A PDF with one short name must stay far below the size of a whole font. The
 * smallest bundled font is 27 KB compressed and the largest is 6 MB, so 12 KB
 * can only hold a subset.
 */
const SUBSET_PDF_BYTE_LIMIT = 12_000;

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
    ["Polish", "Wałęsa Łukasz", /NotoSans-Regular/],
    ["Vietnamese", "Nguyễn Thị Hương", /NotoSans-Regular/],
    ["Russian", "Дмитрий Ёлкин", /NotoSans-Regular/],
    ["Greek", "Γιώργος Παπαδόπουλος", /NotoSans-Regular/],
    ["Chinese", "王小明", /NotoSansSC-Regular/],
    ["Japanese", "山田 さくら", /NotoSansSC-Regular/],
    ["Korean", "김민준", /NotoSansKR-Regular/],
    ["Hindi", "राहुल शर्मा", /NotoSans-Regular/],
    ["Arabic", "محمد عبد الله", /NotoSansArabic-Regular/],
    ["Hebrew", "דוד כהן", /NotoSansHebrew-Regular/],
    ["Thai", "สมศักดิ์ ใจดี", /NotoSansThai-Regular/],
  ])(
    "renders a typed %s signature as written",
    async (_name, value, expectedFont) => {
      const pdf = await generateSignedWaiverPdf({
        sourcePdfBytes: await blankPdf(),
        definition: { id: "definition", fields: [signatureField()] },
        signaturePayload: { signers: [typedSigner(value)], fields: {} },
        timeZone: "America/New_York",
      });

      const drawn = await drawnText(pdf);
      expect(drawn).toContain("Signed: Mar 1, 2026 at 3:15 PM EST");
      expect(drawn.join(" ")).not.toContain(NOTE_OPENING);
      // Nothing was swapped for a "?" in the standard font.
      expect(drawn.join(" ")).not.toContain("?");

      const fonts = await embeddedFonts(pdf);
      expect(fonts).toHaveLength(1);
      expect(fonts[0].name).toMatch(expectedFont);
      expect((await glyphPositions(pdf)).length).toBeGreaterThan(0);
      expect(pdf.length).toBeLessThan(SUBSET_PDF_BYTE_LIMIT);

      // The subset holds a drawable outline for every glyph that was placed.
      const subset = fontkit.create(fonts[0].bytes);
      const glyphs = Array.from({ length: subset.numGlyphs }, (_, id) =>
        subset.getGlyph(id),
      );
      expect(() => glyphs.map((glyph) => glyph.path.toSVG())).not.toThrow();
      const letters = new Set(value.replace(/[\s\p{M}]/gu, ""));
      expect(
        glyphs.filter((glyph) => glyph.path.toSVG().length > 0).length,
      ).toBeGreaterThanOrEqual(Math.min(letters.size, 3));
    },
  );

  test("shapes Devanagari conjuncts instead of drawing separate letters", async () => {
    const source = await blankPdf();
    const render = (value: string) =>
      generateSignedWaiverPdf({
        sourcePdfBytes: source,
        definition: { id: "definition", fields: [signatureField()] },
        signaturePayload: {
          signers: [{ ...typedSigner(value), timestamp: "" }],
          fields: {},
        },
      });

    // क + virama + ष is one conjunct glyph. Three glyphs would be unshaped.
    expect(await glyphPositions(await render("क्ष"))).toHaveLength(1);
    // The short i sign is written after its consonant and drawn before it.
    expect(await glyphPositions(await render("कि"))).toHaveLength(2);
  });

  test("draws right-to-left words from the right", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: { id: "definition", fields: [signatureField()] },
      signaturePayload: {
        signers: [{ ...typedSigner("אב גדה"), timestamp: "" }],
        fields: {},
      },
    });

    // Two words, drawn as two runs. The run drawn second holds the first
    // word, and it sits to the right of the other one.
    const positions = await glyphPositions(pdf);
    expect(positions).toHaveLength(5);
    const [secondWord, firstWord] = [positions.slice(0, 3), positions.slice(3)];
    expect(Math.min(...firstWord.map((glyph) => glyph.x))).toBeGreaterThan(
      Math.max(...secondWord.map((glyph) => glyph.x)),
    );
    expect((await drawnText(pdf)).join(" ")).not.toContain(NOTE_OPENING);
  });

  test("joins Arabic letters into their connected forms", async () => {
    const render = async (value: string) =>
      embeddedFonts(
        await generateSignedWaiverPdf({
          sourcePdfBytes: await blankPdf(),
          definition: { id: "definition", fields: [signatureField()] },
          signaturePayload: {
            signers: [{ ...typedSigner(value), timestamp: "" }],
            fields: {},
          },
        }),
      );

    // The same three letters, joined in a word and standing apart. A renderer
    // that does not shape would embed identical glyphs for both.
    const [joined] = await render("ببب");
    const [apart] = await render("ب ب ب");
    expect(fontkit.create(joined.bytes).numGlyphs).toBeGreaterThan(
      fontkit.create(apart.bytes).numGlyphs,
    );
  });

  test("renders a name that mixes scripts with one font per script", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: { id: "definition", fields: [signatureField()] },
      signaturePayload: {
        signers: [typedSigner("Zoë 王小明 محمد דוד")],
        fields: {},
      },
    });

    const names = (await embeddedFonts(pdf)).map((font) => font.name).sort();
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/NotoSansArabic-Regular/);
    expect(names[1]).toMatch(/NotoSansHebrew-Regular/);
    expect(names[2]).toMatch(/NotoSansSC-Regular/);
    const drawn = await drawnText(pdf);
    expect(drawn[0].trim()).toBe("Zoë");
    expect(drawn.join(" ")).not.toContain(NOTE_OPENING);
  });

  test.each([
    ["an emoji", "Sam 😀"],
    ["a script with no bundled font", "தமிழ்"],
  ])("keeps the note for %s", async (_name, value) => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: { id: "definition", fields: [signatureField()] },
      signaturePayload: { signers: [typedSigner(value)], fields: {} },
    });

    const drawn = (await drawnText(pdf)).join(" ");
    expect(drawn).toContain(NOTE_OPENING);
    expect(drawn).toContain("?");
    expect(await embeddedFonts(pdf)).toHaveLength(0);
  });

  test("keeps the supported part of a name beside an unsupported character", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: { id: "definition", fields: [signatureField()] },
      signaturePayload: { signers: [typedSigner("王小明😀")], fields: {} },
    });

    const fonts = await embeddedFonts(pdf);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].name).toMatch(/NotoSansSC-Regular/);
    expect(await glyphPositions(pdf)).toHaveLength(3);
    expect((await drawnText(pdf)).join(" ")).toContain(NOTE_OPENING);
  });

  test("never throws on hostile text", async () => {
    const values = [
      String.fromCodePoint(0xd800),
      String.fromCodePoint(0x200d, 0x200c, 0xfe0f),
      String.fromCodePoint(0x0301, 0x0e49, 0x094d),
      String.fromCodePoint(0x202e) + "abc" + String.fromCodePoint(0x10ffff),
      "(((ב]]] {א} <ג>",
      "\n\n王\n\n",
      "ـ".repeat(400),
      "क्".repeat(200),
    ];
    for (const value of values) {
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
              rect: { x: 72, y: 600, width: 40, height: 20 },
              signer_role_key: "volunteer",
            },
          ],
        },
        signaturePayload: {
          signers: [typedSigner(value)],
          fields: { full_name: value },
        },
      });
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    }
  });

  test("falls back to the note when the font files cannot be read", async () => {
    const projectRoot = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "waiver-fonts-")));
    try {
      const pdf = await generateSignedWaiverPdf({
        sourcePdfBytes: await blankPdf(),
        definition: { id: "definition", fields: [signatureField()] },
        signaturePayload: {
          signers: [typedSigner("Nguyễn Thị Hương")],
          fields: {},
        },
      });

      const drawn = (await drawnText(pdf)).join(" ");
      expect(drawn).toContain("Nguyen Thi Huong");
      expect(drawn).toContain(NOTE_OPENING);
      expect(await embeddedFonts(pdf)).toHaveLength(0);
    } finally {
      process.chdir(projectRoot);
    }
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

  test("a waiver the standard font can encode embeds no font", async () => {
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
        signers: [typedSigner("Zoë O'Brien-Müller")],
        fields: { full_name: "Zoë O'Brien-Müller" },
      },
    });

    expect(await embeddedFonts(pdf)).toHaveLength(0);
    expect(await glyphPositions(pdf)).toHaveLength(0);
    expect(
      (await drawnText(pdf)).filter((text) => text.startsWith("Zo")),
    ).toEqual(["Zoë O'Brien-Müller", "Zoë O'Brien-Müller"]);
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

    const drawn = (await drawnText(pdf)).join(" ");
    expect(drawn).not.toContain("Nguyen");
    expect(drawn).not.toContain(NOTE_OPENING);
    const fonts = await embeddedFonts(pdf);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].name).toMatch(/NotoSans-Regular/);
    // At least one glyph per letter, all on the field's single line.
    const positions = await glyphPositions(pdf);
    expect(positions.length).toBeGreaterThanOrEqual("NguyễnThịHương".length);
    expect(new Set(positions.map((glyph) => glyph.y)).size).toBe(1);
  });

  test("wraps unspaced text inside the field's width", async () => {
    const pdf = await generateSignedWaiverPdf({
      sourcePdfBytes: await blankPdf(),
      definition: {
        id: "definition",
        fields: [
          {
            field_key: "home_address",
            field_type: "address",
            page_index: 0,
            rect: { x: 72, y: 600, width: 120, height: 60 },
            signer_role_key: "volunteer",
          },
        ],
      },
      signaturePayload: {
        signers: [],
        fields: { home_address: "東京都千代田区丸の内一丁目九番一号東京駅" },
      },
    });

    const positions = await glyphPositions(pdf);
    expect(positions).toHaveLength(20);
    expect(new Set(positions.map((glyph) => glyph.y)).size).toBeGreaterThan(1);
    for (const glyph of positions) {
      expect(glyph.x).toBeGreaterThanOrEqual(72);
      expect(glyph.x).toBeLessThan(72 + 120);
    }
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
