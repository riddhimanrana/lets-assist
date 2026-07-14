import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRedirectPath } from "./redirect-utils";

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
