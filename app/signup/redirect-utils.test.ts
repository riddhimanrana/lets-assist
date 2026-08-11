import assert from "node:assert/strict";
import test from "node:test";

import { isCsfConnectRedirect, normalizeRedirectPath } from "./redirect-utils";

test("accepts only same-origin relative redirect paths", () => {
  assert.equal(
    normalizeRedirectPath("/projects/example?signup=1#slot"),
    "/projects/example?signup=1#slot",
  );
  assert.equal(normalizeRedirectPath("https://evil.example"), null);
  assert.equal(normalizeRedirectPath("//evil.example/path"), null);
  assert.equal(normalizeRedirectPath("/%2F%2Fevil.example/path"), null);
  assert.equal(normalizeRedirectPath("/\\evil.example/path"), null);
  assert.equal(normalizeRedirectPath(" /home"), null);
  assert.equal(normalizeRedirectPath("/home\nSet-Cookie: bad"), null);
});

test("recognizes CSF cohort connect redirect paths", () => {
  assert.equal(
    isCsfConnectRedirect("/organization/dvhs/plugins/dvhs-csf/connect"),
    true,
  );
  assert.equal(
    isCsfConnectRedirect("/organization/dvhs/plugins/dvhs-csf/connect/abc123"),
    true,
  );
  assert.equal(
    isCsfConnectRedirect(
      "/organization/dvhs/plugins/dvhs-csf/connect/abc123?foo=bar",
    ),
    true,
  );
  assert.equal(
    isCsfConnectRedirect(
      "/organization/dvhs/plugins/dvhs-csf/connect?tab=csf-profile#top",
    ),
    true,
  );
  assert.equal(
    isCsfConnectRedirect(
      "%2Forganization%2Fdvhs%2Fplugins%2Fdvhs-csf%2Fconnect%2Fabc123",
    ),
    true,
  );
});

test("rejects non-CSF-connect redirect paths", () => {
  assert.equal(isCsfConnectRedirect(null), false);
  assert.equal(isCsfConnectRedirect(undefined), false);
  assert.equal(isCsfConnectRedirect(""), false);
  assert.equal(isCsfConnectRedirect("/home"), false);
  assert.equal(
    isCsfConnectRedirect("/organization/dvhs/plugins/dvhs-csf"),
    false,
  );
  assert.equal(
    isCsfConnectRedirect("/organization/dvhs/plugins/dvhs-csf/overview"),
    false,
  );
  // Other plugin.
  assert.equal(
    isCsfConnectRedirect("/organization/dvhs/plugins/other-plugin/connect"),
    false,
  );
  // Weird casing never matches the case-sensitive route.
  assert.equal(
    isCsfConnectRedirect("/Organization/dvhs/plugins/DVHS-CSF/connect"),
    false,
  );
  assert.equal(
    isCsfConnectRedirect("/organization/dvhs/plugins/dvhs-csf/Connect/abc"),
    false,
  );
  // Missing org segment.
  assert.equal(
    isCsfConnectRedirect("/organization/plugins/dvhs-csf/connect"),
    false,
  );
  // Too deep.
  assert.equal(
    isCsfConnectRedirect(
      "/organization/dvhs/plugins/dvhs-csf/connect/abc123/extra",
    ),
    false,
  );
  // Unsafe redirects normalize to null and never match.
  assert.equal(
    isCsfConnectRedirect(
      "https://evil.example/organization/dvhs/plugins/dvhs-csf/connect",
    ),
    false,
  );
  assert.equal(
    isCsfConnectRedirect("//evil.example/plugins/dvhs-csf/connect"),
    false,
  );
});
