import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// These one-time controllers pin complete historical file contents. Tests must
// not reapprove today's combined release just to create a passing fixture.
const reviewedSources = Object.freeze({
  schema: "415b8060d2466924bbb7e9567920f57455dc0aa1",
  security: "1e43cb58975f7a30c23404fd786a9fc55c208cee",
  membership: "494d8247f2e8327866b0287c029bbd419cf8de33",
});

export function readReviewedHotfixFile(kind, path) {
  const source = reviewedSources[kind];
  if (
    !source ||
    !/^(?:\.github\/|docs\/|scripts\/|supabase\/|vendor\/|package\.json$|bun\.lock$)/u.test(
      path,
    )
  )
    throw new Error("Unknown historical hotfix fixture.");
  return execFileSync("git", ["show", `${source}:${path}`], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  });
}
