import assert from "node:assert/strict";
import { test } from "node:test";

import { validateApplicationArchiveListings } from "./validate-application-archive.mjs";

test("accepts confined Vercel files, directories, and relative symlinks", () => {
  assert.doesNotThrow(() =>
    validateApplicationArchiveListings(
      [
        ".vercel/output/",
        ".vercel/output/config.json",
        ".vercel/output/functions/health.func/",
        ".vercel/output/functions/health.rsc.func",
      ].join("\n"),
      [
        "drwxr-xr-x 0 0 0 0 Jan 1 00:00 .vercel/output/",
        "-rw-r--r-- 0 0 0 1 Jan 1 00:00 .vercel/output/config.json",
        "drwxr-xr-x 0 0 0 0 Jan 1 00:00 .vercel/output/functions/health.func/",
        "lrwxrwxrwx 0 0 0 0 Jan 1 00:00 .vercel/output/functions/health.rsc.func -> health.func",
      ].join("\n"),
    ),
  );
});

test("rejects paths outside the Vercel output", () => {
  assert.throws(
    () =>
      validateApplicationArchiveListings(
        ".vercel/output/../../etc/passwd\n",
        "-rw-r--r-- 0 0 0 1 Jan 1 00:00 .vercel/output/../../etc/passwd\n",
      ),
    /unsafe archive path/u,
  );
});

test("rejects symlinks that escape the Vercel output", () => {
  assert.throws(
    () =>
      validateApplicationArchiveListings(
        ".vercel/output/functions/escape\n",
        "lrwxrwxrwx 0 0 0 0 Jan 1 00:00 .vercel/output/functions/escape -> ../../../outside\n",
      ),
    /escaping archive symlink/u,
  );
});

test("rejects entries written through a symlink", () => {
  assert.throws(
    () =>
      validateApplicationArchiveListings(
        [
          ".vercel/output/functions/alias",
          ".vercel/output/functions/alias/payload",
        ].join("\n"),
        [
          "lrwxrwxrwx 0 0 0 0 Jan 1 00:00 .vercel/output/functions/alias -> target",
          "-rw-r--r-- 0 0 0 1 Jan 1 00:00 .vercel/output/functions/alias/payload",
        ].join("\n"),
      ),
    /traversal through symlink/u,
  );
});
