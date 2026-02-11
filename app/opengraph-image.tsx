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
  mutedText: "#71717a",
  primary: "#16a34a", // hsl(142.1 76.2% 36.3%)
  overlayLine: "rgba(0, 0, 0, 0.05)",
  overlayGreen: "rgba(34, 197, 94, 0.12)",
};

async function loadFont(fileName: string) {
  try {
    const fontPath = path.join(
      process.cwd(),
      "public",
      "fonts",
      fileName,
    );
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

export default async function Image({
  searchParams: _searchParams,
}: {
  searchParams?: { theme?: string };
} = {}) {
  const [interRegular, interBold, logoSrc] = await Promise.all([
    loadFont("Inter-Regular.ttf"),
    loadFont("Inter-Bold.ttf"),
    getLogoDataUri(),
  ]);
  const fonts: OgFont[] = [];
  if (interRegular) {
    fonts.push({ name: "Inter", data: interRegular, weight: 400, style: "normal" });
  }
  if (interBold) {
    fonts.push({ name: "Inter", data: interBold, weight: 700, style: "normal" });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          backgroundColor: palette.background,
          fontFamily: "Inter, ui-sans-serif, system-ui",
          color: palette.text,
          boxSizing: "border-box",
        }}
      >
        {/* Background Gradients & Grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            opacity: 0.8,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              backgroundImage: `radial-gradient(circle at top, ${palette.overlayGreen}, transparent 70%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              backgroundImage: `linear-gradient(120deg, ${palette.overlayLine} 1px, transparent 1px)`,
              backgroundSize: "160px 160px",
            }}
          />
        </div>

        {/* Content Stack */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            width: "100%",
            height: "100%",
            padding: "80px",
            gap: "48px",
          }}
        >
          {/* Logo + Brand (Center Top-ish) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            {logoSrc ? (
              <img
                src={logoSrc}
                alt="Logo"
                width={52}
                height={52}
                style={{ width: "52px", height: "52px", objectFit: "contain" }}
              />
            ) : null}
            <div
              style={{
                display: "flex",
                fontSize: "36px",
                fontWeight: 700,
                color: palette.text,
                letterSpacing: "-0.01em",
              }}
            >
              Let's Assist
            </div>
          </div>

          {/* Large Headline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: "92px",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              maxWidth: "1000px",
            }}
          >
            <span style={{ display: "flex" }}>Give back to your</span>
            <span style={{ display: "flex", justifyContent: "center", gap: "16px" }}>
              community,{" "}
              <span style={{ color: palette.primary, display: "flex" }}>
                your way.
              </span>
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}