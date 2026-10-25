import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(
  new URL("./audit-supabase-architecture.sh", import.meta.url),
  "utf8",
);
const query = source
  .split('storage_object_policy_posture_gaps="$(')[1]
  .split("fail_if_rows")[0]
  .match(/-c "([\s\S]*)"\s*\)/)?.[1];
assert(query);
const env = { PATH: process.env.PATH, LC_ALL: "C" };
const available = ["initdb", "pg_ctl", "psql"].every(
  (binary) =>
    spawnSync(binary, ["--version"], { env, stdio: "ignore" }).status === 0,
);

test(
  "Storage audit accepts only exact public image denials and preserves other posture checks",
  { skip: !available, timeout: 120_000 },
  () => {
    const root = mkdtempSync(join(tmpdir(), "asp-"));
    const data = join(root, "d");
    let started = false;
    const run = (binary, args, input) =>
      spawnSync(binary, args, {
        env,
        input,
        encoding: "utf8",
        timeout: 30_000,
      });
    const sql = (input) => {
      const result = run(
        "psql",
        [
          "-X",
          "-h",
          root,
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        input,
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      assert.equal(
        run("initdb", [
          "-D",
          data,
          "-A",
          "trust",
          "-U",
          "postgres",
          "--no-sync",
        ]).status,
        0,
      );
      assert.equal(
        run("pg_ctl", [
          "-D",
          data,
          "-l",
          join(root, "postgres.log"),
          "-o",
          `-k ${root} -c listen_addresses=''`,
          "-w",
          "start",
        ]).status,
        0,
      );
      started = true;
      sql(`CREATE SCHEMA app_private;
      CREATE TABLE app_private.buckets(bucket_id text,posture text);
      INSERT INTO app_private.buckets VALUES ('avatars','public'),('organization-logos','public'),('plugin_form_uploads','private-client'),('plugins','server-only');
      CREATE TABLE app_private.policies(policy_name text,command text,role_names text[],is_permissive boolean,using_expression text,with_check_expression text,bucket_id text);
      CREATE FUNCTION app_private.storage_bucket_posture_catalog() RETURNS SETOF app_private.buckets LANGUAGE sql AS $$SELECT * FROM app_private.buckets$$;
      CREATE FUNCTION app_private.storage_object_policy_catalog() RETURNS SETOF app_private.policies LANGUAGE sql AS $$SELECT * FROM app_private.policies$$;
      REVOKE ALL ON FUNCTION app_private.storage_bucket_posture_catalog(),app_private.storage_object_policy_catalog() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION app_private.storage_bucket_posture_catalog(),app_private.storage_object_policy_catalog() TO postgres;
      INSERT INTO app_private.policies
      SELECT 'Server owns ' || label || ' ' || suffix,command,ARRAY['anon','authenticated'],false,
        CASE WHEN command IN ('UPDATE','DELETE') THEN format('(bucket_id <> %L::text)',bucket_id) END,
        CASE WHEN command IN ('INSERT','UPDATE') THEN format('(bucket_id <> %L::text)',bucket_id) END,bucket_id
      FROM (VALUES('avatars','avatar'),('organization-logos','organization logo')) bucket(bucket_id,label)
      CROSS JOIN (VALUES('INSERT','inserts'),('UPDATE','updates'),('DELETE','deletes')) op(command,suffix);
      INSERT INTO app_private.policies VALUES('Ordinary private upload','INSERT',ARRAY['authenticated'],true,NULL,'owner=auth.uid()','plugin_form_uploads');`);
      assert.equal(sql(query), "");
      for (const mutation of [
        "role_names=ARRAY['authenticated']",
        "role_names=ARRAY['public']",
        "is_permissive=true",
        "using_expression='true'",
        "with_check_expression='true'",
        "bucket_id='plugins'",
        "command='SELECT'",
        "policy_name='An unreviewed restrictive policy'",
      ]) {
        const result = sql(
          `BEGIN; UPDATE app_private.policies SET ${mutation} WHERE policy_name='Server owns avatar updates'; ${query} ROLLBACK;`,
        );
        assert.match(
          result,
          /public_image_write_denial_missing_or_changed/,
          mutation,
        );
      }
      assert.match(
        sql(
          `BEGIN; DELETE FROM app_private.policies WHERE policy_name='Server owns avatar inserts'; ${query} ROLLBACK;`,
        ),
        /public_image_write_denial_missing_or_changed/,
      );
      assert.match(
        sql(
          `BEGIN; UPDATE app_private.policies SET is_permissive=false WHERE policy_name='Ordinary private upload'; ${query} ROLLBACK;`,
        ),
        /reviewed_policy_is_restrictive/,
      );
      assert.match(
        sql(
          `BEGIN; UPDATE app_private.policies SET role_names=ARRAY['anon','authenticated'] WHERE policy_name='Ordinary private upload'; ${query} ROLLBACK;`,
        ),
        /policy_roles_are_not_exactly_authenticated/,
      );
      assert.match(
        sql(
          `BEGIN; UPDATE app_private.policies SET bucket_id='plugins' WHERE policy_name='Ordinary private upload'; ${query} ROLLBACK;`,
        ),
        /server_only_bucket_has_client_policy/,
      );
      assert.equal(sql(query), "");
    } finally {
      if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
      rmSync(root, { recursive: true, force: true });
    }
  },
);
