import { describe, expect, test } from "bun:test";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import sharp from "sharp";
import {
  generateSignedWaiverPdf,
  type PdfGenerationOptions,
} from "./generate-signed-waiver-pdf";

type Field = NonNullable<PdfGenerationOptions["definition"]["fields"]>[number];

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

type Box = { x: number; y: number; width: number; height: number };

/** The box the server stamps when a record has no stored definition. */
const FALLBACK_RECT: Box = { x: 100, y: 650, width: 250, height: 60 };
const fallbackDefinition = (id = "synthetic-single-signer") => ({
  id,
  fields: [signatureField({ rect: { ...FALLBACK_RECT } })],
});

const LETTER: [number, number] = [612, 792];
const LANDSCAPE_LETTER: [number, number] = [792, 612];
const A5: [number, number] = [420, 595];

async function sourcePdf(
  size: [number, number],
  crop?: Box,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage(size);
  if (crop) page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  return document.save();
}

/** Each standard-font string with the baseline origin and size it was drawn at. */
async function placedText(
  pdf: Buffer,
): Promise<{ text: string; x: number; y: number; size: number }[]> {
  const source = await pageContent(pdf);
  return Array.from(source.matchAll(/BT([\s\S]*?)ET/g), ([, body]) => {
    const size = /\s(-?[\d.]+) Tf/.exec(body);
    const origin = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/.exec(body);
    const text = /<([0-9A-Fa-f]+)>\s*Tj/.exec(body);
    if (!size || !origin || !text) throw new Error("Unreadable text block");
    return {
      text: Buffer.from(text[1], "hex").toString("latin1"),
      x: Number(origin[1]),
      y: Number(origin[2]),
      size: Number(size[1]),
    };
  });
}

/** Where the one signature image was drawn, read from its transform. */
async function placedImage(pdf: Buffer): Promise<Box> {
  const source = await pageContent(pdf);
  const matrices = Array.from(
    source
      .slice(0, source.indexOf(" Do"))
      .matchAll(
        /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g,
      ),
    (match) => match.slice(1).map(Number),
  );
  const translate = matrices.find(
    ([a, b, c, d, e, f]) =>
      a === 1 && b === 0 && c === 0 && d === 1 && (e !== 0 || f !== 0),
  );
  const scale = matrices.find(
    ([a, b, c, d, e, f]) =>
      b === 0 && c === 0 && e === 0 && f === 0 && (a !== 1 || d !== 1),
  );
  if (!translate || !scale) throw new Error("Unreadable image placement");
  return {
    x: translate[4],
    y: translate[5],
    width: scale[0],
    height: scale[3],
  };
}

async function textBox(drawn: {
  text: string;
  x: number;
  y: number;
  size: number;
}): Promise<Box> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const descent = drawn.size * 0.25;
  return {
    x: drawn.x,
    y: drawn.y - descent,
    width: font.widthOfTextAtSize(drawn.text, drawn.size),
    height: drawn.size + descent,
  };
}

function expectInside(box: Box, visible: Box) {
  const slack = 0.01;
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(visible.x - slack);
  expect(box.y).toBeGreaterThanOrEqual(visible.y - slack);
  expect(box.x + box.width).toBeLessThanOrEqual(
    visible.x + visible.width + slack,
  );
  expect(box.y + box.height).toBeLessThanOrEqual(
    visible.y + visible.height + slack,
  );
}

const STAMP = "Signed: Mar 1, 2026 at 8:15 PM UTC";
const typedPayload = (name = "Alex Johnson") => ({
  signers: [typedSigner(name)],
  fields: {},
});

describe("generateSignedWaiverPdf fallback placement", () => {
  test("a Letter source keeps the fallback box exactly where it was", async () => {
    const render = async (fitFallbackSignatureToPage: boolean) =>
      generateSignedWaiverPdf({
        sourcePdfBytes: await sourcePdf(LETTER),
        definition: fallbackDefinition(),
        signaturePayload: typedPayload(),
        fitFallbackSignatureToPage,
      });

    const fitted = await placedText(await render(true));
    expect(fitted).toEqual([
      { text: "Alex Johnson", x: 105, y: 672, size: 24 },
      { text: STAMP, x: 100, y: 638, size: 8 },
    ]);
    expect(await placedText(await render(false))).toEqual(fitted);
  });

  test.each<[string, [number, number], Box | undefined, Box, Box]>([
    [
      "a landscape Letter page",
      LANDSCAPE_LETTER,
      undefined,
      { x: 0, y: 0, width: 792, height: 612 },
      { x: 100, y: 470, width: 250, height: 60 },
    ],
    [
      "a short portrait A5 page",
      A5,
      undefined,
      { x: 0, y: 0, width: 420, height: 595 },
      { x: 100, y: 453, width: 250, height: 60 },
    ],
    [
      "a crop box that does not start at the origin",
      LANDSCAPE_LETTER,
      { x: 200, y: 100, width: 400, height: 300 },
      { x: 200, y: 100, width: 400, height: 300 },
      { x: 300, y: 258, width: 250, height: 60 },
    ],
    [
      "a visible area smaller than the fallback box",
      LETTER,
      { x: 200, y: 300, width: 200, height: 60 },
      { x: 200, y: 300, width: 200, height: 60 },
      { x: 200, y: 316, width: 200, height: 44 },
    ],
  ])(
    "fits the fallback signature and its stamp onto %s",
    async (_name, size, crop, visible, expected) => {
      const sourcePdfBytes = await sourcePdf(size, crop);

      const typed = await placedText(
        await generateSignedWaiverPdf({
          sourcePdfBytes,
          definition: fallbackDefinition(),
          signaturePayload: typedPayload(),
          fitFallbackSignatureToPage: true,
        }),
      );
      expect(typed.map((drawn) => drawn.text)).toEqual(["Alex Johnson", STAMP]);
      const [name, stamp] = typed;
      expect(name.x).toBe(expected.x + 5);
      expect(name.y).toBeGreaterThan(expected.y);
      expect(stamp).toMatchObject({ x: expected.x, y: expected.y - 12 });
      expectInside(await textBox(name), visible);
      expectInside(await textBox(stamp), visible);

      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "black" },
      })
        .png()
        .toBuffer();
      const drawn = await generateSignedWaiverPdf({
        sourcePdfBytes,
        definition: fallbackDefinition(),
        signaturePayload: {
          signers: [
            {
              role_key: "volunteer",
              method: "draw",
              data: `data:image/png;base64,${png.toString("base64")}`,
              timestamp: "2026-03-01T20:15:00.000Z",
            },
          ],
          fields: {},
        },
        fitFallbackSignatureToPage: true,
      });
      const image = await placedImage(drawn);
      expect(image).toEqual(expected);
      expectInside(image, visible);
      const [imageStamp] = await placedText(drawn);
      expect(imageStamp).toMatchObject({
        text: STAMP,
        x: expected.x,
        y: expected.y - 12,
      });
      expectInside(await textBox(imageStamp), visible);
    },
  );

  test("scales a long typed name down to end before a narrow page does", async () => {
    const longName = "Maximiliana Alexandria Featherstonehaugh-Montgomery";
    const [name] = await placedText(
      await generateSignedWaiverPdf({
        sourcePdfBytes: await sourcePdf(A5),
        definition: fallbackDefinition(),
        signaturePayload: typedPayload(longName),
        fitFallbackSignatureToPage: true,
      }),
    );

    expect(name.text).toBe(longName);
    expect(name.size).toBeLessThan(24);
    expect(name.size).toBeGreaterThanOrEqual(6);
    expectInside(await textBox(name), { x: 0, y: 0, width: 420, height: 595 });
  });

  test("does not write to the definition it was given", async () => {
    const definition = fallbackDefinition();
    const before = structuredClone(definition);
    Object.freeze(definition.fields[0].rect);
    Object.freeze(definition.fields[0]);

    await generateSignedWaiverPdf({
      sourcePdfBytes: await sourcePdf(LANDSCAPE_LETTER),
      definition,
      signaturePayload: typedPayload(),
      fitFallbackSignatureToPage: true,
    });

    expect(definition).toEqual(before);
  });

  test("refuses a source page too small for the fallback before reading storage", async () => {
    const paths: string[] = [];
    await expect(
      generateSignedWaiverPdf({
        sourcePdfBytes: await sourcePdf([100, 100]),
        definition: fallbackDefinition(),
        signaturePayload: {
          signers: [
            {
              role_key: "volunteer",
              method: "draw",
              data: "signature-images/fictional-volunteer.png",
              timestamp: "2026-03-01T20:15:00.000Z",
            },
          ],
          fields: {},
        },
        storageResolver: async (path) => {
          paths.push(path);
          return new ArrayBuffer(0);
        },
        fitFallbackSignatureToPage: true,
      }),
    ).rejects.toMatchObject({ code: "unplaceable_signature" });
    expect(paths).toEqual([]);
  });

  test.each([
    ["a stored definition", "55555555-5555-4555-8555-555555555555"],
    [
      "a definition that only carries the fallback's id",
      "synthetic-single-signer",
    ],
  ])(
    "never moves the same box for %s without the server's flag",
    async (_name, id) => {
      for (const size of [LANDSCAPE_LETTER, A5]) {
        await expect(
          generateSignedWaiverPdf({
            sourcePdfBytes: await sourcePdf(size),
            definition: fallbackDefinition(id),
            signaturePayload: typedPayload(),
          }),
        ).rejects.toMatchObject({ code: "unplaceable_signature" });
      }
    },
  );
});
