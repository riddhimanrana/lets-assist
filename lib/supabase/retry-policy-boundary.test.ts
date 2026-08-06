import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SUPABASE_DB_OPTIONS } from "./retry-policy";

const factoryFiles = ["admin.ts", "client.ts", "proxy.ts", "server.ts"];

test("Supabase factories preserve the application-owned retry boundary", () => {
  expect(SUPABASE_DB_OPTIONS).toEqual({ retry: false });

  for (const file of factoryFiles) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source).toContain('from "./retry-policy"');
    expect(source).toContain("db: SUPABASE_DB_OPTIONS");
  }
});
