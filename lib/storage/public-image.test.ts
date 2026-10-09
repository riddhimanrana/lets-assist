import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import {
  ownedPublicImagePath,
  preparePublicImage,
  publicImageKey,
} from "./public-image";
const owner = "11111111-1111-4111-8111-111111111111";
const origin = "https://storage.example.test/storage/v1/object/public/avatars/";
const image = () =>
  sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } });
const uri = (bytes: Buffer, format = "png") =>
  `data:image/${format};base64,${bytes.toString("base64")}`;
describe("public raster image preparation", () => {
  for (const format of ["png", "jpeg", "webp"] as const)
    test(`${format} becomes a metadata-free WebP`, async () => {
      const input = await image()
        .withMetadata({
          exif: { IFD0: { Artist: "Synthetic private metadata" } },
        })
        .toFormat(format)
        .toBuffer();
      const output = await preparePublicImage(uri(input, format));
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(4);
      expect(metadata.height).toBe(3);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(output.includes(Buffer.from("Synthetic private metadata"))).toBe(
        false,
      );
    });
  test("declared type must match decoded type", async () => {
    await expect(
      preparePublicImage(uri(await image().png().toBuffer(), "jpeg")),
    ).rejects.toThrow("could not be decoded");
  });
  test("corrupt raster and disguised SVG are refused", async () => {
    for (const input of [
      Buffer.from("corrupt-image"),
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
      ),
    ])
      await expect(preparePublicImage(uri(input))).rejects.toThrow(
        "could not be decoded",
      );
  });
  test("rejects invalid base64 and excess decoded bytes", async () => {
    for (const value of [
      "data:image/png;base64,AAAA=",
      "data:image/png;base64,a a",
      "data:image/png;base64,",
      uri(Buffer.alloc(5 * 1024 * 1024 + 1)),
    ])
      await expect(preparePublicImage(value)).rejects.toThrow();
  });
  test("rejects oversized dimensions before output", async () => {
    const bytes = await sharp({
      create: { width: 8200, height: 1, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    await expect(preparePublicImage(uri(bytes))).rejects.toThrow(
      "could not be decoded",
    );
  });
  test("caps output dimensions", async () => {
    const bytes = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const result = await sharp(await preparePublicImage(uri(bytes))).metadata();
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });
});
describe("owned immutable storage identifiers", () => {
  for (const bucket of ["avatars", "organization-logos"] as const)
    test(bucket, () => {
      const key = publicImageKey(bucket, owner);
      expect(key).not.toBe(publicImageKey(bucket, owner));
      const base = origin.replace("avatars", bucket);
      expect(
        ownedPublicImagePath(`${base}${key}?v=123`, base, bucket, owner),
      ).toBe(key);
      expect(
        ownedPublicImagePath(
          `${base}${key}`,
          base,
          bucket,
          "22222222-2222-4222-8222-222222222222",
        ),
      ).toBeNull();
      expect(
        ownedPublicImagePath(
          `${base}${key}`,
          "https://other.example.test",
          bucket,
          owner,
        ),
      ).toBeNull();
      expect(
        ownedPublicImagePath(
          `${base}${owner}/../other.png`,
          base,
          bucket,
          owner,
        ),
      ).toBeNull();
      expect(
        ownedPublicImagePath(
          `${base}${owner}%2fother.png`,
          base,
          bucket,
          owner,
        ),
      ).toBeNull();
    });
  test("supports historical avatar and logo names on a custom storage origin", () => {
    expect(
      ownedPublicImagePath(
        `${origin}${owner}-123456789.jpg`,
        origin,
        "avatars",
        owner,
      ),
    ).toBe(`${owner}-123456789.jpg`);
    const base = origin.replace("avatars", "organization-logos");
    expect(
      ownedPublicImagePath(
        `${base}${owner}.png`,
        base,
        "organization-logos",
        owner,
      ),
    ).toBe(`${owner}.png`);
  });
});
