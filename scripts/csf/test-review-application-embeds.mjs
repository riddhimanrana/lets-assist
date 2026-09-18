import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getCsfIsolatedSupabaseEnv } from "../local-dev/dv-local-env.mjs";

const { url, serviceRoleKey } = getCsfIsolatedSupabaseEnv();
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const plugin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "plugin_data" },
});
const organizationId = randomUUID();
const cohortId = randomUUID();
const termId = randomUUID();
const count = 505;
const profiles = Array.from({ length: count }, (_, index) => ({
  id: randomUUID(),
  organization_id: organizationId,
  first_name: "Fictional",
  last_name: `Embed ${index}`,
  normalized_first_name: "fictional",
  normalized_last_name: `embed ${index}`,
}));
const applications = profiles.map((profile) => ({
  id: randomUUID(),
  organization_id: organizationId,
  profile_id: profile.id,
  cohort_id: cohortId,
  term_id: termId,
}));

async function insert(table, rows, client = plugin) {
  for (let index = 0; index < rows.length; index += 150) {
    const { error } = await client
      .from(table)
      .insert(rows.slice(index, index + 150));
    if (error)
      throw new Error(
        `${table} insert: ${error.code ?? "unknown"} ${error.message}`,
      );
  }
}

async function main() {
  const started = performance.now();
  let cleanupError = null;
  try {
    await insert(
      "organizations",
      [
        {
          id: organizationId,
          name: "CSF Embed Verification",
          username: `csf-embed-${organizationId.slice(0, 12)}`,
          type: "school",
          description: "Transient fictional local integration fixture.",
          show_members_publicly: false,
          join_code: String(Math.floor(Math.random() * 900000) + 100000),
        },
      ],
      admin,
    );
    await insert("csf_cohorts", [
      {
        id: cohortId,
        organization_id: organizationId,
        graduation_year: 2030,
        label: "Class of 2030",
      },
    ]);
    await insert("csf_terms", [
      {
        id: termId,
        organization_id: organizationId,
        code: "F26",
        label: "Fall 2026",
        school_year: "2026-2027",
        semester: "fall",
        starts_at: "2026-08-01",
        ends_at: "2026-12-31",
        is_current: true,
      },
    ]);
    await insert("csf_profiles", profiles);
    await insert("csf_term_applications", applications);
    const selected = [applications[0], applications[250], applications[504]];
    const selectedProfiles = [profiles[0], profiles[250], profiles[504]];
    await insert(
      "csf_application_course_entries",
      selected.flatMap((application, index) =>
        [0, 1].map((ordinal) => ({
          organization_id: organizationId,
          application_id: application.id,
          course_list: "I",
          course_name: `Fictional course ${index}-${ordinal}`,
          created_at: `2026-09-01T00:00:0${ordinal}Z`,
        })),
      ),
    );
    await insert(
      "csf_application_files",
      selected.map((application, index) => ({
        organization_id: organizationId,
        application_id: application.id,
        profile_id: selectedProfiles[index].id,
        term_id: termId,
        file_type: "transcript",
        object_path: `fictional-embed-check/${index}`,
      })),
    );
    await insert(
      "csf_application_correction_requests",
      selected.map((application, index) => ({
        organization_id: organizationId,
        application_id: application.id,
        profile_id: selectedProfiles[index].id,
        check_type: "course_data",
        message: `Fictional course correction ${index}`,
      })),
    );

    const select = [
      "id",
      "courses:csf_application_course_entries!csf_application_course_entries_application_organization_fkey(id, application_id, course_list, raw_line, course_name, created_at)",
      "files:csf_application_files!csf_application_files_application_organization_fkey(id, application_id, file_type, source_url, provider, drive_file_id)",
      "corrections:csf_application_correction_requests!csf_application_corrections_application_organization_fkey(id, application_id, check_type, message, status, review_reason, created_at)",
    ].join(", ");
    const readStarted = performance.now();
    const pages = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await plugin
        .from("csf_term_applications")
        .select(select)
        .eq("organization_id", organizationId)
        .eq("term_id", termId)
        .order("id", { ascending: true })
        .range(from, from + 499);
      if (error)
        throw new Error(
          `PostgREST embed: ${error.code ?? "unknown"} ${error.message}`,
        );
      if (
        !Array.isArray(data) ||
        data.some(
          (row) =>
            !Array.isArray(row.courses) ||
            !Array.isArray(row.files) ||
            !Array.isArray(row.corrections),
        )
      )
        throw new Error("An embed was missing from the paged response.");
      pages.push(data);
      if (data.length < 500) break;
    }
    const rows = pages.flat();
    const childCount = (key) =>
      rows.reduce((sum, row) => sum + row[key].length, 0);
    if (
      rows.length !== count ||
      childCount("courses") !== 6 ||
      childCount("files") !== 3 ||
      childCount("corrections") !== 3
    )
      throw new Error("PostgREST lost a parent or child row across pages.");
    for (const application of selected) {
      const row = rows.find((entry) => entry.id === application.id);
      if (
        !row ||
        row.courses.length !== 2 ||
        row.files.length !== 1 ||
        row.corrections.length !== 1
      )
        throw new Error("One selected application's children are incomplete.");
    }
    process.stdout.write(
      JSON.stringify({
        parents: rows.length,
        pages: pages.map((page) => page.length),
        courses: childCount("courses"),
        files: childCount("files"),
        corrections: childCount("corrections"),
        readMs: Math.round(performance.now() - readStarted),
        totalMs: Math.round(performance.now() - started),
      }) + "\n",
    );
  } finally {
    const { error } = await admin
      .from("organizations")
      .delete()
      .eq("id", organizationId);
    if (error)
      cleanupError = new Error(
        `Fixture cleanup: ${error.code ?? "unknown"} ${error.message}`,
      );
  }
  if (cleanupError) throw cleanupError;
}

await main();
