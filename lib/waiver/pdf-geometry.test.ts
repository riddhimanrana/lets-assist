import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";

import {
  assertSignedWaiverPlaceable,
  generateSignedWaiverPdf,
} from "./generate-signed-waiver-pdf";
import {
  SYNTHETIC_SINGLE_SIGNER_RECT,
  evidencePlacementFits,
  fieldFitsSource,
  readWaiverSourceGeometry,
  type FieldRect,
  type WaiverPlacementField,
} from "./pdf-geometry";

type Crop = [number, number, number, number];

async function sourcePdf(
  sizes: [number, number][],
  crop?: Crop,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const size of sizes) {
    const page = document.addPage(size);
    if (crop) page.setCropBox(...crop);
  }
  return document.save();
}

const LETTER: [number, number] = [612, 792];
const LANDSCAPE: [number, number] = [792, 612];
const BOX: FieldRect = { x: 100, y: 200, width: 200, height: 50 };

const signature = (
  overrides: Partial<WaiverPlacementField> = {},
): WaiverPlacementField => ({
  field_type: "signature",
  page_index: 0,
  rect: BOX,
  signer_role_key: "participant",
  required: true,
  ...overrides,
});

// A minimal password-protected document. It parses, and reports encryption.
function encryptedPdf(): Buffer {
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
}

describe("readWaiverSourceGeometry", () => {
  test("measures every page of the actual document", async () => {
    const geometry = await readWaiverSourceGeometry(
      await sourcePdf([LETTER, LANDSCAPE]),
    );

    expect(geometry.pages).toEqual([
      { left: 0, right: 612, bottom: 0, top: 792 },
      { left: 0, right: 792, bottom: 0, top: 612 },
    ]);
  });

  test("the visible area is where the media and crop boxes overlap", async () => {
    const geometry = await readWaiverSourceGeometry(
      await sourcePdf([LETTER], [100, 100, 300, 400]),
    );

    expect(geometry.pages).toEqual([
      { left: 100, right: 400, bottom: 100, top: 500 },
    ]);
  });

  test("refuses a document the parser cannot read", async () => {
    await expect(
      readWaiverSourceGeometry(
        Buffer.from("%PDF-1.7 fictional broken document"),
      ),
    ).rejects.toMatchObject({ code: "unreadable_source" });
  });

  test("refuses a real PDF whose crop box has no visible media overlap", async () => {
    const bytes = await sourcePdf([LETTER], [1000, 1000, 100, 100]);
    await expect(readWaiverSourceGeometry(bytes)).rejects.toMatchObject({
      code: "unreadable_source",
    });
  });

  test("refuses a document with no pages", async () => {
    const empty = await PDFDocument.create();

    await expect(
      readWaiverSourceGeometry(await empty.save({ addDefaultPage: false })),
    ).rejects.toMatchObject({ code: "unreadable_source" });
  });

  test("refuses a password-protected document", async () => {
    await expect(
      readWaiverSourceGeometry(encryptedPdf()),
    ).rejects.toMatchObject({ code: "encrypted_source" });
  });
});

describe("fieldFitsSource", () => {
  test("accepts a box on a real page and refuses a missing page", async () => {
    const geometry = await readWaiverSourceGeometry(await sourcePdf([LETTER]));

    expect(fieldFitsSource(signature(), geometry)).toBe(true);
    expect(fieldFitsSource(signature({ page_index: 1 }), geometry)).toBe(false);
    expect(fieldFitsSource(signature({ page_index: -1 }), geometry)).toBe(
      false,
    );
    expect(fieldFitsSource(signature({ page_index: 0.5 }), geometry)).toBe(
      false,
    );
    expect(fieldFitsSource(signature({ page_index: null }), geometry)).toBe(
      false,
    );
  });

  test("refuses a box that leaves the media box or has no area", async () => {
    const geometry = await readWaiverSourceGeometry(await sourcePdf([LETTER]));

    for (const rect of [
      { ...BOX, x: 600 },
      { ...BOX, y: 780 },
      { ...BOX, width: 0 },
      { ...BOX, height: -5 },
      { ...BOX, x: Number.NaN },
    ]) {
      expect(fieldFitsSource(signature({ rect }), geometry)).toBe(false);
    }
    expect(fieldFitsSource(signature({ rect: null }), geometry)).toBe(false);
  });

  test("refuses a box inside the media box but outside the crop box", async () => {
    const geometry = await readWaiverSourceGeometry(
      await sourcePdf([LETTER], [100, 100, 300, 400]),
    );

    expect(fieldFitsSource(signature(), geometry)).toBe(true);
    expect(
      fieldFitsSource(signature({ rect: { ...BOX, x: 10 } }), geometry),
    ).toBe(false);
    expect(
      fieldFitsSource(signature({ rect: { ...BOX, y: 480 } }), geometry),
    ).toBe(false);
  });

  test("a box that only fits a landscape page is judged per page", async () => {
    const geometry = await readWaiverSourceGeometry(
      await sourcePdf([LETTER, LANDSCAPE]),
    );
    const wide = { x: 560, y: 100, width: 200, height: 50 };

    expect(fieldFitsSource(signature({ rect: wide }), geometry)).toBe(false);
    expect(
      fieldFitsSource(signature({ rect: wide, page_index: 1 }), geometry),
    ).toBe(true);
  });
});

describe("evidencePlacementFits", () => {
  const participant = { role_key: "participant", required: true };
  const guardian = { role_key: "guardian", required: false };
  const check = async (input: {
    signers?: { role_key: string; required?: boolean }[];
    fields: WaiverPlacementField[];
    signedRoleKeys?: string[];
  }) =>
    evidencePlacementFits({
      geometry: await readWaiverSourceGeometry(await sourcePdf([LETTER])),
      signers: input.signers ?? [participant],
      fields: input.fields,
      signedRoleKeys: input.signedRoleKeys ?? ["participant"],
    });

  test("a signed signer needs a signature field that fits", async () => {
    expect(await check({ fields: [signature()] })).toBe(true);
    expect(await check({ fields: [] })).toBe(false);
    expect(await check({ fields: [signature({ page_index: 3 })] })).toBe(false);
    // One good box does not excuse a second one that is off the page.
    expect(
      await check({
        fields: [signature(), signature({ rect: { ...BOX, x: 600 } })],
      }),
    ).toBe(false);
  });

  test("a required signer is held to the rule even when absent from the payload", async () => {
    expect(
      await check({
        fields: [signature({ page_index: 3 })],
        signedRoleKeys: [],
      }),
    ).toBe(false);
  });

  test("an initials field is not a signature placement", async () => {
    expect(
      await check({ fields: [signature({ field_type: "initial" })] }),
    ).toBe(false);
  });

  test("a required name field off the page is refused", async () => {
    const name = signature({
      field_type: "name",
      rect: { x: 580, y: 700, width: 120, height: 20 },
    });

    expect(await check({ fields: [signature(), name] })).toBe(false);
    expect(
      await check({ fields: [signature(), { ...name, required: false }] }),
    ).toBe(true);
  });

  test("an optional signer who did not sign is not judged, and one who did is", async () => {
    const guardianFields = [
      signature({ signer_role_key: "guardian", page_index: 5 }),
      signature({
        signer_role_key: "guardian",
        field_type: "name",
        page_index: 5,
      }),
    ];
    const input = {
      signers: [participant, guardian],
      fields: [signature(), ...guardianFields],
    };

    expect(await check(input)).toBe(true);
    expect(
      await check({ ...input, signedRoleKeys: ["participant", "guardian"] }),
    ).toBe(false);
  });
});

describe("the pre-signing check and the renderer agree", () => {
  const typed = {
    signers: [
      {
        role_key: "participant",
        method: "typed" as const,
        data: "Fictional Volunteer",
        timestamp: "2026-10-11T12:00:00.000Z",
      },
    ],
    fields: {},
  };
  const definition = (
    rect: FieldRect,
    pageIndex = 0,
    id = "22222222-2222-4222-8222-222222222222",
  ) => ({
    id,
    fields: [
      {
        field_key: "signature",
        field_type: "signature",
        page_index: pageIndex,
        rect,
        signer_role_key: "participant",
      },
    ],
  });

  test.each<[string, [number, number][], FieldRect, number]>([
    ["a box on the page", [LETTER], BOX, 0],
    ["a box off the page", [LETTER], { ...BOX, x: 600 }, 0],
    ["a missing page", [LETTER], BOX, 2],
    ["a second landscape page", [LETTER, LANDSCAPE], { ...BOX, x: 560 }, 1],
  ])("for a stored definition with %s", async (_name, sizes, rect, page) => {
    const sourcePdfBytes = await sourcePdf(sizes);
    const options = {
      sourcePdfBytes,
      definition: definition(rect, page),
      signaturePayload: typed,
    };
    const geometry = await readWaiverSourceGeometry(sourcePdfBytes);
    const fits = fieldFitsSource({ page_index: page, rect }, geometry);

    const outcome = (run: Promise<unknown>) =>
      run.then(
        () => true,
        (error: { code?: string }) => {
          expect(error.code).toBe("unplaceable_signature");
          return false;
        },
      );
    expect(await outcome(assertSignedWaiverPlaceable(options))).toBe(fits);
    expect(await outcome(generateSignedWaiverPdf(options))).toBe(fits);
  });

  test.each<[string, [number, number], boolean]>([
    ["a Letter page", LETTER, true],
    ["a landscape page", LANDSCAPE, true],
    ["a short A5 page", [420, 595], true],
    ["a page too small for the box", [100, 100], false],
  ])("for the fallback box on %s", async (_name, size, placeable) => {
    const options = {
      sourcePdfBytes: await sourcePdf([size]),
      definition: definition(
        { ...SYNTHETIC_SINGLE_SIGNER_RECT },
        0,
        "synthetic-single-signer",
      ),
      signaturePayload: typed,
      fitFallbackSignatureToPage: true,
    };

    const check = assertSignedWaiverPlaceable(options);
    if (placeable) {
      await expect(check).resolves.toBeUndefined();
      await expect(generateSignedWaiverPdf(options)).resolves.toBeInstanceOf(
        Buffer,
      );
    } else {
      await expect(check).rejects.toMatchObject({
        code: "unplaceable_signature",
      });
    }
  });

  test("the check reports a protected or unreadable source like the renderer", async () => {
    const options = { definition: definition(BOX), signaturePayload: typed };

    await expect(
      assertSignedWaiverPlaceable({
        ...options,
        sourcePdfBytes: encryptedPdf(),
      }),
    ).rejects.toMatchObject({ code: "encrypted_source" });
    await expect(
      assertSignedWaiverPlaceable({
        ...options,
        sourcePdfBytes: Buffer.from("fictional invalid PDF"),
      }),
    ).rejects.toMatchObject({ code: "unreadable_source" });
  });

  test("the check never reads a signature asset", async () => {
    await expect(
      assertSignedWaiverPlaceable({
        sourcePdfBytes: await sourcePdf([LETTER]),
        definition: definition(BOX),
        signaturePayload: {
          signers: [
            {
              role_key: "participant",
              method: "draw",
              data: "signatures/fictional-volunteer.png",
              timestamp: "2026-10-11T12:00:00.000Z",
            },
          ],
          fields: {},
        },
      }),
    ).resolves.toBeUndefined();
  });
});

test("the fallback box matches the one the signed-copy routes stamp", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/waiver/serve-signed-waiver.ts"),
    "utf8",
  );
  const { x, y, width, height } = SYNTHETIC_SINGLE_SIGNER_RECT;

  expect(source).toContain(
    `rect: { x: ${x}, y: ${y}, width: ${width}, height: ${height} }`,
  );
});
