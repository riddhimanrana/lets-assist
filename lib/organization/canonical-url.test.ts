import { expect, test } from "bun:test";
import { organizationCanonicalUrl } from "./canonical-url";

test("organization canonicalization preserves notification destinations", () => {
  expect(organizationCanonicalUrl("dvhighcsf", { tab: "csf-home" })).toBe(
    "/organization/dvhighcsf?tab=csf-home",
  );
});

test("canonicalization preserves repeated and encoded query values", () => {
  const result = organizationCanonicalUrl("dvhighcsf", {
    tab: "csf-overview",
    filter: ["needs review", "a&b"],
    empty: "",
    absent: undefined,
  });
  const url = new URL(result, "https://lets-assist.com");
  expect(url.searchParams.getAll("filter")).toEqual(["needs review", "a&b"]);
  expect(url.searchParams.get("empty")).toBe("");
  expect(url.searchParams.has("absent")).toBe(false);
  expect(url.searchParams.get("tab")).toBe("csf-overview");
});

test("canonical destination remains a local organization path", () => {
  expect(organizationCanonicalUrl("//elsewhere.example/path", {})).toBe(
    "/organization/%2F%2Felsewhere.example%2Fpath",
  );
  expect(organizationCanonicalUrl("dvhighcsf", {})).toBe(
    "/organization/dvhighcsf",
  );
});
