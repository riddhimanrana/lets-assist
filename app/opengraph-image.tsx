import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

type OgFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight?: OgFontWeight;
  style?: "normal" | "italic";
};

const palette = {
  background: "#ffffff",
  text: "#09090b",
  primary: "#22c55e",
  primaryDark: "#16a34a",
  overlayGreen: "rgba(34, 197, 94, 0.15)",
  overlayLine: "rgba(0, 0, 0, 0.05)",
  mutedText: "#71717a",
};

async function loadFont(fileName: string) {
  try {
    const fontPath = path.join(process.cwd(), "public/fonts", fileName);
    const fontBuffer = await readFile(fontPath);
    return fontBuffer.buffer.slice(
      fontBuffer.byteOffset,
      fontBuffer.byteOffset + fontBuffer.byteLength,
    );
  } catch (error) {
    console.warn("OG font read failed:", error);
    return null;
  }
}

async function getLogoDataUri(): Promise<string | null> {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo.png");
    const logoBuffer = await readFile(logoPath);
    const base64 = logoBuffer.toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.warn("OG logo read failed:", error);
    return null;
  }
}

export default async function Image() {
  const [groteskExtraBold, groteskBold, logoSrc] = await Promise.all([
    loadFont("OverusedGrotesk-ExtraBold.ttf"),
    loadFont("OverusedGrotesk-Bold.ttf"),
    getLogoDataUri(),
  ]);

  const fonts: OgFont[] = [];

  if (groteskExtraBold) {
    fonts.push({
      name: "Overused Grotesk",
      data: groteskExtraBold,
      weight: 900,
      style: "normal",
    });
  }

  if (groteskBold) {
    fonts.push({
      name: "Overused Grotesk",
      data: groteskBold,
      weight: 700,
      style: "normal",
    });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(34, 197, 94, 0.35) 0%, transparent 80%)",
          fontFamily: 'Overused Grotesk, "sans-serif"',
          color: palette.text,
          textAlign: "center",
        }}
      >
        {/* Branding Section */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            marginBottom: 48,
          }}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Logo"
              width={54}
              height={54}
              style={{ borderRadius: 12 }}
            />
          ) : null}
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: palette.text,
            }}
          >
            Let's Assist
          </div>
        </div>

        {/* Main Content Stack */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
          }}
        >
          {/* Huge Headline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              fontSize: 106,
              fontWeight: 900,
              lineHeight: 1.0,
              letterSpacing: "-0.04em",
              maxWidth: 1100,
            }}
          >
            <div style={{ display: "flex" }}>Give back to your</div>
            <div style={{ display: "flex", gap: 16 }}>
              <div
                style={{
                  backgroundImage: "linear-gradient(to right, #4ed247, #1AA54A)",
                  backgroundClip: "text",
                  // @ts-ignore
                  "-webkit-background-clip": "text",
                  color: "transparent",
                  display: "flex",
                }}
              >
                community
              </div>
              <div style={{ display: "flex" }}>your way</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fonts.length ? fonts : undefined,
    },
  );
}