import "server-only";

import JSZip from "jszip";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  ACCOUNT_EXPORT_MAX_JSON_BYTES as MAX_JSON_BYTES,
  ACCOUNT_EXPORT_MAX_ZIP_BYTES as MAX_ZIP_BYTES,
} from "./data-export-limits";

const CATEGORIES = {
  "profile-data": [
    "projectDrafts",
    "pluginDisplayPreferences",
    "organizationJoinSuppressions",
    "profile",
    "userEmails",
    "calendarConnections",
    "organizationMemberships",
    "organizationsCreated",
    "projectsCreated",
  ],
  "certificates-and-hours": [
    "certificates",
    "projectSignups",
    "attendanceIntervals",
    "waiverSignatures",
    "anonymousSignupsLinked",
  ],
  notifications: ["notificationSettings", "notifications"],
  "trust-safety-and-feedback": ["contentReports", "feedback", "trustedMember"],
  "csf-records": [
    "csfStaffViewPreferences",
    "csfCalendarBindings",
    "csfBroadcastPreferences",
    "csfPointAppeals",
    "csfProfile",
    "csfAccountLinks",
    "csfCohortMemberships",
    "csfApplications",
    "csfCourses",
    "csfTermMemberships",
    "csfTermOutcomes",
    "csfRestrictions",
    "csfPointSubmissions",
    "csfCredits",
    "csfMeetingAttendance",
    "csfOpportunitySignups",
    "csfDues",
    "csfApplicationFiles",
    "csfSubmissionFiles",
    "csfCorrections",
  ],
  "dv-records": [
    "dvLegacyMemberships",
    "dvStudents",
    "dvMemberships",
    "dvRequirements",
    "dvRegistrations",
    "dvEntries",
    "dvMeetingAttendance",
    "dvTeacherProfile",
    "dvLegacySubmissions",
    "dvLegacyAnswers",
  ],
} as const;
export const ACCOUNT_EXPORT_DATASET_NAMES = Object.values(CATEGORIES).flat();
const DATASETS = ACCOUNT_EXPORT_DATASET_NAMES;
const SENSITIVE_KEY =
  /(token|secret|password|encrypted|api[_-]?key|access[_-]?key|join[_-]?code|signed[_-]?url)/i;
const SCOPE = {
  description:
    "Account-owned records from the listed datasets at one database snapshot.",
  included:
    "Platform records, verified CSF profile records, and DV records linked by account UUID or authored submission.",
  excluded: [
    "Credentials, access links, provider tokens, raw Auth metadata, staff-only notes, other people's records, and source spreadsheets.",
    "Unlinked or revoked CSF profiles and DV contact records without an authenticated account link. Email or name similarity does not prove ownership.",
    "Binary attachments and externally hosted files. File metadata is included where an owned record exists; request copies through the owning organization.",
    "Internal security, moderation, provider, and organization audit logs. The export contains the user's submitted reports and member-visible status, not staff evidence.",
  ],
  limits:
    "10,000 rows per dataset, 100,000 total records, 40 MB JSON, 50 MB ZIP. Exceeding a limit fails the export; it never silently truncates.",
} as const;
const snapshotSchema = z.object({
  schemaVersion: z.literal("2026-10-07"),
  generatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  userId: z.string().uuid(),
  auth: z
    .object({
      id: z.string().uuid(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      createdAt: z.string().nullable(),
      lastSignInAt: z.string().nullable(),
      emailConfirmedAt: z.string().nullable(),
      phoneConfirmedAt: z.string().nullable(),
      identities: z.array(
        z
          .object({
            provider: z.string(),
            createdAt: z.string().nullable(),
            lastSignInAt: z.string().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
  datasets: z.record(
    z.string(),
    z.array(z.record(z.string(), z.unknown())).max(10_000),
  ),
  counts: z.record(z.string(), z.number().int().nonnegative().max(10_000)),
  totalRecords: z.number().int().nonnegative().max(100_000),
});

/** Strip credential-shaped keys from user-authored structured answers too. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry),
    ]),
  );
}

export type UserDataExportPayload = {
  metadata: {
    schemaVersion: string;
    generatedAt: string;
    userId: string;
    sanitized: true;
    totalDatasets: number;
    totalRecords: number;
    issueCount: 0;
    scope: typeof SCOPE;
  };
  auth: Record<string, unknown>;
  datasets: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
  issues: never[];
};

type SnapshotReader = (userId: string) => Promise<unknown>;
async function readSnapshot(userId: string) {
  const { data, error } = await getAdminClient({ timeoutMs: 30_000 }).rpc(
    "account_data_export_snapshot",
    { p_user_id: userId },
  );
  if (error) throw new Error("Account export snapshot unavailable");
  return data;
}

export async function createUserDataExport(
  userId: string,
  options?: { sanitizeSensitive?: boolean },
  dependencies: { readSnapshot?: SnapshotReader } = {},
): Promise<{ payload: UserDataExportPayload; json: string; fileName: string }> {
  z.string().uuid().parse(userId);
  if (options?.sanitizeSensitive === false)
    throw new Error("Unsanitized account exports are not supported");
  const raw = await (dependencies.readSnapshot ?? readSnapshot)(userId);
  if (Buffer.byteLength(JSON.stringify(raw ?? null)) > MAX_JSON_BYTES)
    throw new Error("Account export size limit exceeded");
  const snapshot = snapshotSchema.parse(raw);
  if (snapshot.userId !== userId || snapshot.auth.id !== userId)
    throw new Error("Account export subject mismatch");
  const keys = Object.keys(snapshot.datasets).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify([...DATASETS].sort()) ||
    JSON.stringify(Object.keys(snapshot.counts).sort()) !== JSON.stringify(keys)
  ) {
    throw new Error("Account export dataset contract mismatch");
  }
  let total = 0;
  for (const key of keys) {
    const count = snapshot.datasets[key].length;
    if (snapshot.counts[key] !== count)
      throw new Error("Account export count mismatch");
    total += count;
  }
  if (total !== snapshot.totalRecords)
    throw new Error("Account export total mismatch");
  const payload = redact({
    metadata: {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      userId,
      sanitized: true,
      totalDatasets: keys.length,
      totalRecords: total,
      issueCount: 0,
      scope: SCOPE,
    },
    auth: snapshot.auth,
    datasets: snapshot.datasets,
    counts: snapshot.counts,
    issues: [],
  }) as UserDataExportPayload;
  const json = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(json) > MAX_JSON_BYTES)
    throw new Error("Account export size limit exceeded");
  return { payload, json, fileName: `lets-assist-data-export-${userId}.json` };
}

export async function createUserDataExportArchive(
  userId: string,
  options?: { sanitizeSensitive?: boolean },
  dependencies: { readSnapshot?: SnapshotReader } = {},
) {
  const { payload } = await createUserDataExport(userId, options, dependencies);
  const zip = new JSZip();
  const categories = Object.entries(CATEGORIES).map(([folder, datasets]) => ({
    folder,
    files: datasets.map((name) => `${name}.json`),
    recordCount: datasets.reduce((sum, name) => sum + payload.counts[name], 0),
  }));
  const manifest = {
    ...payload.metadata,
    categories: [
      ...categories,
      { folder: "auth", files: ["auth.json"], recordCount: 1 },
    ],
  };
  const zipDate = new Date(payload.metadata.generatedAt);
  const addFile = (name: string, value: unknown) =>
    zip.file(name, JSON.stringify(value, null, 2), { date: zipDate });
  addFile("manifest.json", manifest);
  addFile("auth/auth.json", payload.auth);
  addFile("counts.json", payload.counts);
  for (const [folder, datasets] of Object.entries(CATEGORIES)) {
    for (const name of datasets)
      addFile(`${folder}/${name}.json`, payload.datasets[name]);
  }
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (zipBuffer.length > MAX_ZIP_BYTES)
    throw new Error("Account export archive size limit exceeded");
  return {
    zipBuffer,
    fileName: `lets-assist-data-export-${userId}.zip`,
    payload,
    manifest,
  };
}
