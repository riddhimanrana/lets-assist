import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const runtimeSource = readFileSync(
  new URL("./data-export-jobs.ts", import.meta.url),
  "utf8",
);
const configSource = readFileSync(
  new URL("../../supabase/config.toml", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../supabase/migrations/20260730001002_align_data_exports_bucket_limit.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("data-export Storage bucket contract", () => {
  test("keeps declarative and runtime limits at the 50 MiB global ceiling", () => {
    expect(configSource).toContain('[storage.buckets."data-exports"]');
    expect(configSource).toContain('file_size_limit = "50MiB"');
    expect(runtimeSource).toContain(
      'const EXPORT_BUCKET_FILE_SIZE_LIMIT = "50MB";',
    );
    expect(runtimeSource).toContain(
      "fileSizeLimit: EXPORT_BUCKET_FILE_SIZE_LIMIT",
    );
  });

  test("replay corrects the historical 100 MiB bucket value", () => {
    expect(migrationSource).toContain("where id = 'data-exports'");
    expect(migrationSource).toContain("file_size_limit = 52428800");
    expect(migrationSource).toContain(
      "allowed_mime_types = array['application/zip']::text[]",
    );
    expect(migrationSource).toContain("public = false");
  });
});
