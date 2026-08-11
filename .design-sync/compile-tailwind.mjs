import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const input = resolve("app/globals.css");
const outPath = resolve(".design-sync/.compiled/tailwind.compiled.css");
mkdirSync(dirname(outPath), { recursive: true });

const css = readFileSync(input, "utf8");
const result = await postcss([tailwindcss({ base: process.cwd() })]).process(
  css,
  {
    from: input,
    to: outPath,
  },
);

// next/font (geist + next/font/local) injects these @font-face + variable
// bindings at build time in the real app — never present in globals.css.
// The matching @font-face rules live in .design-sync/fonts.css (cfg.extraFonts,
// which only extracts @font-face blocks); the variable bindings must ship
// here instead since extractFonts drops any other CSS it finds.
const fontVarBindings = `
:root {
  --font-geist-sans: "GeistSansVar";
  --font-geist-mono: "GeistMonoVar";
  --font-overusedgrotesk: "OverusedGrotesk";
  --font-nohemi: "Nohemi";
  --font-cheese-milky: "CheeseMilky";
}
`;

const out = result.css + fontVarBindings;
writeFileSync(outPath, out);
console.log(`compiled ${out.length} bytes -> ${outPath}`);
