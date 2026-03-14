import { logError } from "@/lib/logger";
import { getAdminClient } from "@/lib/supabase/admin";
import JSZip from "jszip";

type ExportSpec = {
  key: string;
  table: string;
  column: string;
  single?: boolean;
};

type ExportIssue = {
  key: string;
  table: string;
  message: string;
};

const EXPORT_SPECS: ExportSpec[] = [
  { key: "profile", table: "profiles", column: "id", single: true },
  { key: "userEmails", table: "user_emails", column: "user_id" },
  { key: "notificationSettings", table: "notification_settings", column: "user_id", single: true },
  { key: "notifications", table: "notifications", column: "user_id" },
  { key: "feedback", table: "feedback", column: "user_id" },
  { key: "trustedMember", table: "trusted_member", column: "user_id" },
  { key: "projectSignups", table: "project_signups", column: "user_id" },
  { key: "certificates", table: "certificates", column: "user_id" },
  { key: "contentReports", table: "content_reports", column: "reporter_id" },
  { key: "calendarConnections", table: "user_calendar_connections", column: "user_id" },
  { key: "organizationMemberships", table: "organization_members", column: "user_id" },
  { key: "organizationsCreated", table: "organizations", column: "created_by" },
  { key: "projectsCreated", table: "projects", column: "creator_id" },
  { key: "anonymousSignupsLinked", table: "anonymous_signups", column: "linked_user_id" },
  { key: "waiverSignatures", table: "waiver_signatures", column: "user_id" },
];

const SENSITIVE_KEY_REGEX =
  /(token|secret|password|encrypted|api[_-]?key|access[_-]?key|refresh[_-]?token|verification[_-]?token)/i;

function redactSensitiveValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item)) as T;
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(input)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactSensitiveValues(val);
      }
    }

    return output as T;
  }

  return value;
}

async function queryUserScopedData(
  userId: string,
): Promise<{
  data: Record<string, unknown>;
  issues: ExportIssue[];
}> {
  const supabaseAdmin = getAdminClient();
  const data: Record<string, unknown> = {};
  const issues: ExportIssue[] = [];

  for (const spec of EXPORT_SPECS) {
    try {
      if (spec.single) {
        const { data: row, error } = await supabaseAdmin
          .from(spec.table)
          .select("*")
          .eq(spec.column, userId)
          .maybeSingle();

        if (error) {
          issues.push({ key: spec.key, table: spec.table, message: error.message });
          data[spec.key] = null;
          continue;
        }

        data[spec.key] = row ?? null;
      } else {
        const { data: rows, error } = await supabaseAdmin
          .from(spec.table)
          .select("*")
          .eq(spec.column, userId);

        if (error) {
          issues.push({ key: spec.key, table: spec.table, message: error.message });
          data[spec.key] = [];
          continue;
        }

        data[spec.key] = rows ?? [];
      }
    } catch (error) {
      issues.push({
        key: spec.key,
        table: spec.table,
        message: error instanceof Error ? error.message : "Unknown export error",
      });
      data[spec.key] = spec.single ? null : [];
    }
  }

  return { data, issues };
}

function countRecords(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }

  return value ? 1 : 0;
}

export type UserDataExportPayload = {
  metadata: {
    schemaVersion: string;
    generatedAt: string;
    userId: string;
    sanitized: boolean;
    totalDatasets: number;
    totalRecords: number;
    issueCount: number;
  };
  auth: {
    id: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    userMetadata: Record<string, unknown> | null;
    appMetadata: Record<string, unknown> | null;
    identities: Array<Record<string, unknown>>;
  } | null;
  datasets: Record<string, unknown>;
  counts: Record<string, number>;
  issues: ExportIssue[];
};

type ExportCategoryDefinition = {
  folder: string;
  datasets: string[];
};

const EXPORT_CATEGORY_DEFINITIONS: ExportCategoryDefinition[] = [
  {
    folder: "profile-data",
    datasets: [
      "profile",
      "userEmails",
      "calendarConnections",
      "organizationMemberships",
      "organizationsCreated",
      "projectsCreated",
    ],
  },
  {
    folder: "certificates-and-hours",
    datasets: ["certificates", "projectSignups", "waiverSignatures", "anonymousSignupsLinked"],
  },
  {
    folder: "notifications",
    datasets: ["notificationSettings", "notifications"],
  },
  {
    folder: "trust-safety-and-feedback",
    datasets: ["contentReports", "feedback", "trustedMember"],
  },
  {
    folder: "auth",
    datasets: [],
  },
  {
    folder: "internal-logs",
    datasets: [],
  },
];

export async function createUserDataExport(
  userId: string,
  options?: {
    sanitizeSensitive?: boolean;
  },
): Promise<{
  payload: UserDataExportPayload;
  json: string;
  fileName: string;
}> {
  const sanitizeSensitive = options?.sanitizeSensitive ?? true;
  const supabaseAdmin = getAdminClient();

  const [{ data: authResult, error: authError }, { data: datasets, issues }] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    queryUserScopedData(userId),
  ]);

  if (authError) {
    logError("Failed to fetch auth user during data export", authError, { user_id: userId });
  }

  const authUser = authResult?.user
    ? {
        id: authResult.user.id,
        email: authResult.user.email ?? null,
        phone: authResult.user.phone ?? null,
        role: authResult.user.role ?? null,
        createdAt: authResult.user.created_at ?? null,
        lastSignInAt: authResult.user.last_sign_in_at ?? null,
        userMetadata:
          (authResult.user.user_metadata as Record<string, unknown> | null | undefined) ?? null,
        appMetadata:
          (authResult.user.app_metadata as Record<string, unknown> | null | undefined) ?? null,
        identities: (authResult.user.identities ?? []).map((identity) => ({
          ...(identity as unknown as Record<string, unknown>),
        })),
      }
    : null;

  const counts = Object.fromEntries(
    Object.entries(datasets).map(([key, value]) => [key, countRecords(value)]),
  );

  const totalRecords = Object.values(counts).reduce((sum, value) => sum + value, 0);

  const rawPayload: UserDataExportPayload = {
    metadata: {
      schemaVersion: "2026-03-01",
      generatedAt: new Date().toISOString(),
      userId,
      sanitized: sanitizeSensitive,
      totalDatasets: Object.keys(datasets).length,
      totalRecords,
      issueCount: issues.length,
    },
    auth: authUser,
    datasets,
    counts,
    issues,
  };

  const payload = sanitizeSensitive
    ? redactSensitiveValues(rawPayload)
    : rawPayload;

  const json = JSON.stringify(payload, null, 2);
  const isoDate = new Date().toISOString().slice(0, 10);

  return {
    payload,
    json,
    fileName: `lets-assist-data-export-${userId}-${isoDate}.json`,
  };
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildCategoryManifest(payload: UserDataExportPayload) {
  return EXPORT_CATEGORY_DEFINITIONS.map((category) => {
    if (category.folder === "auth") {
      const count = payload.auth ? 1 : 0;
      return {
        folder: category.folder,
        files: ["auth.json"],
        recordCount: count,
      };
    }

    if (category.folder === "internal-logs") {
      return {
        folder: category.folder,
        files: ["counts.json", "issues.json", "export-metadata.json"],
        recordCount: payload.issues.length,
      };
    }

    const files = category.datasets.map((dataset) => `${dataset}.json`);
    const recordCount = category.datasets.reduce((sum, dataset) => {
      const value = payload.counts[dataset] ?? 0;
      return sum + value;
    }, 0);

    return {
      folder: category.folder,
      files,
      recordCount,
    };
  });
}

export async function createUserDataExportArchive(
  userId: string,
  options?: {
    sanitizeSensitive?: boolean;
  },
): Promise<{
  zipBuffer: Buffer;
  fileName: string;
  payload: UserDataExportPayload;
  manifest: {
    schemaVersion: string;
    generatedAt: string;
    userId: string;
    totalRecords: number;
    issueCount: number;
    categories: Array<{ folder: string; files: string[]; recordCount: number }>;
  };
}> {
  const exportResult = await createUserDataExport(userId, options);
  const { payload } = exportResult;
  const zip = new JSZip();

  const categoryManifest = buildCategoryManifest(payload);

  const manifest = {
    schemaVersion: payload.metadata.schemaVersion,
    generatedAt: payload.metadata.generatedAt,
    userId,
    totalRecords: payload.metadata.totalRecords,
    issueCount: payload.issues.length,
    categories: categoryManifest,
  };

  zip.file("manifest.json", toJson(manifest));

  for (const category of EXPORT_CATEGORY_DEFINITIONS) {
    if (category.folder === "auth") {
      zip.file(`${category.folder}/auth.json`, toJson(payload.auth));
      continue;
    }

    if (category.folder === "internal-logs") {
      zip.file(`${category.folder}/counts.json`, toJson(payload.counts));
      zip.file(`${category.folder}/issues.json`, toJson(payload.issues));
      zip.file(`${category.folder}/export-metadata.json`, toJson(payload.metadata));
      continue;
    }

    for (const dataset of category.datasets) {
      zip.file(`${category.folder}/${dataset}.json`, toJson(payload.datasets[dataset] ?? null));
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const isoDate = new Date().toISOString().slice(0, 10);

  return {
    zipBuffer,
    fileName: `lets-assist-data-export-${userId}-${isoDate}.zip`,
    payload,
    manifest,
  };
}