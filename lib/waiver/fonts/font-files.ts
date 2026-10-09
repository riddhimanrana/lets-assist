/**
 * The Unicode fonts a signed waiver can embed, in fallback order.
 *
 * The files are regular-weight Noto fonts under the SIL Open Font License,
 * read from their npm packages at runtime. `next.config.ts` imports this list
 * so the two waiver routes carry exactly these files in their server bundle.
 * This module has no imports for that reason.
 *
 * `script` is only a hint about which font to try first. Whether a font is
 * used is decided by the glyphs it holds.
 */
export interface UnicodeFontFile {
  id: string;
  /** Path from the project root. */
  path: string;
  script: RegExp;
}

const PACKAGES = "node_modules/@expo-google-fonts";

export const UNICODE_FONT_FILES: readonly UnicodeFontFile[] = [
  {
    // Latin with its extensions and Vietnamese, Cyrillic, Greek, Devanagari.
    id: "noto-sans",
    path: `${PACKAGES}/noto-sans/400Regular/NotoSans_400Regular.ttf`,
    script:
      /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Devanagari}]/u,
  },
  {
    // Chinese, and the kana and kanji of Japanese.
    id: "noto-sans-sc",
    path: `${PACKAGES}/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf`,
    script: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  },
  {
    id: "noto-sans-kr",
    path: `${PACKAGES}/noto-sans-kr/400Regular/NotoSansKR_400Regular.ttf`,
    script: /\p{Script=Hangul}/u,
  },
  {
    id: "noto-sans-arabic",
    path: `${PACKAGES}/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf`,
    script: /\p{Script=Arabic}/u,
  },
  {
    id: "noto-sans-hebrew",
    path: `${PACKAGES}/noto-sans-hebrew/400Regular/NotoSansHebrew_400Regular.ttf`,
    script: /\p{Script=Hebrew}/u,
  },
  {
    id: "noto-sans-thai",
    path: `${PACKAGES}/noto-sans-thai/400Regular/NotoSansThai_400Regular.ttf`,
    script: /\p{Script=Thai}/u,
  },
];

/** Globs for `outputFileTracingIncludes`, resolved from the project root. */
export const UNICODE_FONT_TRACE_GLOBS: string[] = UNICODE_FONT_FILES.map(
  (file) => `./${file.path}`,
);
