import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../../migrations/20260912015112_csf_sheet_no_comments_transport.sql",
    import.meta.url,
  ),
  "utf8",
);

test("none joins the legacy transports without changing the SQL default", () => {
  expect(migration).not.toContain("ALTER COLUMN discussion_transport SET DEFAULT");
  expect(migration).toContain(
    "discussion_transport IN ('none','native','column')",
  );
  expect(migration).toContain(
    "discussion_transport<>'none' OR NOT managed_headers",
  );
});

test("acceptance skips only the mode-specific discussion checks for none", () => {
  expect(migration).toContain("IF d.discussion_transport='native' THEN");
  expect(migration).toContain("ELSIF d.discussion_transport='column' THEN");
  expect(migration).toContain(
    "Repeated sync needs distinct retained export versions.",
  );
  expect(migration).toContain(
    "Approval, rejection and correction need reviewed application and point receipts.",
  );
});

test("none removes discussions from destination versions without changing legacy modes", () => {
  expect(migration).toContain(
    "RENAME TO csf_sheet_sync_destination_snapshot_with_discussions",
  );
  expect(migration).toContain(
    "IF transport='none' THEN RETURN snapshot-ARRAY['comments','local_messages']; END IF;",
  );
  expect(migration).toContain("RETURN snapshot;");
  expect(migration).toContain(
    "REVOKE ALL ON FUNCTION plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;",
  );
});
