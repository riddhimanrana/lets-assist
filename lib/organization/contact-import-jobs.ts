import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/services/email";
import OrganizationInvitation from "@/emails/organization-invitation";
import { parseContactImportFile } from "@/lib/organization/contact-import-parser";
import type {
  ContactImportCreateResponse,
  ContactImportProcessResponse,
  ContactImportRole,
  OrganizationContactImportJob,
} from "@/types/contact-import";
import type { BulkInviteResponse, BulkInviteResult } from "@/types/invitation";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ContactImportJobRow = {
  id: string;
  organization_id: string;
  created_by: string | null;
  source_file_name: string;
  source_file_type: "csv" | "xlsx" | "xls";
  role: ContactImportRole;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  processed_rows: number;
  successful_invites: number;
  failed_invites: number;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type ContactImportRowRow = {
  id: string;
  row_number: number;
  email: string;
  full_name: string | null;
  profile_data: Record<string, string> | null;
  status: "pending" | "invited" | "skipped" | "failed";
  error: string | null;
  invitation_id: string | null;
};

type OrganizationContext = {
  id: string;
  name: string;
  username: string;
};

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 250;
const ROW_INSERT_CHUNK_SIZE = 500;

function toJob(row: ContactImportJobRow): OrganizationContactImportJob {
  return {
    id: row.id,
    organization_id: row.organization_id,
    created_by: row.created_by,
    source_file_name: row.source_file_name,
    source_file_type: row.source_file_type,
    role: row.role,
    status: row.status,
    total_rows: row.total_rows,
    valid_rows: row.valid_rows,
    invalid_rows: row.invalid_rows,
    duplicate_rows: row.duplicate_rows,
    processed_rows: row.processed_rows,
    successful_invites: row.successful_invites,
    failed_invites: row.failed_invites,
    started_at: row.started_at,
    completed_at: row.completed_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function isOrgAdmin(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .single();

  return data?.role === "admin";
}

async function getOrganizationContext(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<OrganizationContext | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, username")
    .eq("id", organizationId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as OrganizationContext;
}

async function getInviterName(
  supabase: SupabaseClient,
  inviterId: string | null,
): Promise<string> {
  if (!inviterId) {
    return "An admin";
  }

  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", inviterId)
    .single();

  const profile = data as { full_name: string | null; email: string | null } | null;
  return profile?.full_name || profile?.email || "An admin";
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://lets-assist.com";
}

function getExpirationDetails(): { expiresAtIso: string; expiresAtDisplay: string } {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  return {
    expiresAtIso: expiresAt.toISOString(),
    expiresAtDisplay: expiresAt.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export async function createContactImportJobFromFile(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  role: ContactImportRole;
  file: File;
}): Promise<ContactImportCreateResponse> {
  const { supabase, organizationId, userId, role, file } = params;

  const admin = await isOrgAdmin(supabase, organizationId, userId);
  if (!admin) {
    return {
      success: false,
      error: "Only organization admins can run contact imports.",
    };
  }

  const organization = await getOrganizationContext(supabase, organizationId);
  if (!organization) {
    return { success: false, error: "Organization not found." };
  }

  let parsed;
  try {
    parsed = await parseContactImportFile(file);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to parse uploaded file.",
    };
  }

  const noValidRows = parsed.rows.length === 0;
  const initialStatus: ContactImportJobRow["status"] = noValidRows ? "failed" : "pending";
  const initialError = noValidRows
    ? "No valid email rows were found in the uploaded file."
    : null;

  const { data: jobData, error: createJobError } = await supabase
    .from("organization_contact_import_jobs")
    .insert({
      organization_id: organization.id,
      created_by: userId,
      source_file_name: file.name,
      source_file_type: parsed.fileType,
      role,
      status: initialStatus,
      total_rows: parsed.summary.totalRows,
      valid_rows: parsed.summary.validRows,
      invalid_rows: parsed.summary.invalidRows,
      duplicate_rows: parsed.summary.duplicateRows,
      processed_rows: noValidRows ? 0 : 0,
      successful_invites: 0,
      failed_invites: noValidRows ? parsed.summary.invalidRows : 0,
      completed_at: noValidRows ? new Date().toISOString() : null,
      last_error: initialError,
    })
    .select(
      "id, organization_id, created_by, source_file_name, source_file_type, role, status, total_rows, valid_rows, invalid_rows, duplicate_rows, processed_rows, successful_invites, failed_invites, started_at, completed_at, last_error, created_at, updated_at",
    )
    .single();

  if (createJobError || !jobData) {
    return {
      success: false,
      error: createJobError?.message || "Failed to create contact import job.",
    };
  }

  const job = jobData as ContactImportJobRow;

  if (!noValidRows) {
    const rowPayload = parsed.rows.map((row) => ({
      job_id: job.id,
      organization_id: organization.id,
      row_number: row.rowNumber,
      email: row.email,
      full_name: row.fullName,
      profile_data: row.profileData,
      status: "pending" as const,
    }));

    for (let i = 0; i < rowPayload.length; i += ROW_INSERT_CHUNK_SIZE) {
      const chunk = rowPayload.slice(i, i + ROW_INSERT_CHUNK_SIZE);
      const { error: rowInsertError } = await supabase
        .from("organization_contact_import_rows")
        .insert(chunk);

      if (rowInsertError) {
        await supabase
          .from("organization_contact_import_jobs")
          .update({
            status: "failed",
            last_error: rowInsertError.message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        return {
          success: false,
          error: "Failed to store parsed contact rows for processing.",
          parseSummary: parsed.summary,
          invalidRowsPreview: parsed.invalidRows.slice(0, 25),
        };
      }
    }
  }

  return {
    success: true,
    job: toJob(job),
    parseSummary: parsed.summary,
    invalidRowsPreview: parsed.invalidRows.slice(0, 25),
    message: noValidRows
      ? "Import saved, but no valid contacts were found to invite."
      : "Import uploaded and queued for batch processing.",
  };
}

export async function getContactImportJobStatus(params: {
  supabase: SupabaseClient;
  jobId: string;
  userId: string;
}): Promise<ContactImportProcessResponse> {
  const { supabase, jobId, userId } = params;

  const { data: jobData, error: jobError } = await supabase
    .from("organization_contact_import_jobs")
    .select(
      "id, organization_id, created_by, source_file_name, source_file_type, role, status, total_rows, valid_rows, invalid_rows, duplicate_rows, processed_rows, successful_invites, failed_invites, started_at, completed_at, last_error, created_at, updated_at",
    )
    .eq("id", jobId)
    .single();

  if (jobError || !jobData) {
    return { success: false, error: "Import job not found." };
  }

  const job = jobData as ContactImportJobRow;
  const admin = await isOrgAdmin(supabase, job.organization_id, userId);

  if (!admin) {
    return { success: false, error: "Only organization admins can access this import job." };
  }

  const { data: failedRows } = await supabase
    .from("organization_contact_import_rows")
    .select("row_number, email, error, status")
    .eq("job_id", job.id)
    .in("status", ["failed", "skipped"])
    .order("row_number", { ascending: true })
    .limit(25);

  return {
    success: true,
    job: toJob(job),
    failedRowsPreview: (failedRows || []) as Array<{
      row_number: number;
      email: string;
      error: string | null;
      status: "failed" | "skipped";
    }>,
  };
}

export async function processContactImportJobBatch(params: {
  supabase: SupabaseClient;
  jobId: string;
  userId: string;
  batchSize?: number;
}): Promise<ContactImportProcessResponse> {
  const { supabase, jobId, userId } = params;
  const batchSize = Math.min(Math.max(params.batchSize ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);

  const { data: jobData, error: jobError } = await supabase
    .from("organization_contact_import_jobs")
    .select(
      "id, organization_id, created_by, source_file_name, source_file_type, role, status, total_rows, valid_rows, invalid_rows, duplicate_rows, processed_rows, successful_invites, failed_invites, started_at, completed_at, last_error, created_at, updated_at",
    )
    .eq("id", jobId)
    .single();

  if (jobError || !jobData) {
    return { success: false, error: "Import job not found." };
  }

  const job = jobData as ContactImportJobRow;
  const admin = await isOrgAdmin(supabase, job.organization_id, userId);
  if (!admin) {
    return { success: false, error: "Only organization admins can process this import job." };
  }

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return {
      success: true,
      job: toJob(job),
      batch: {
        processed: 0,
        invited: 0,
        skipped: 0,
        failed: 0,
      },
    };
  }

  const organization = await getOrganizationContext(supabase, job.organization_id);
  if (!organization) {
    return { success: false, error: "Organization not found for this import job." };
  }

  const inviterName = await getInviterName(supabase, job.created_by);
  const baseUrl = getBaseUrl();
  const { expiresAtIso, expiresAtDisplay } = getExpirationDetails();

  if (!job.started_at) {
    await supabase
      .from("organization_contact_import_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job.id);
  } else {
    await supabase
      .from("organization_contact_import_jobs")
      .update({ status: "processing" })
      .eq("id", job.id);
  }

  const { data: pendingRowsData, error: pendingRowsError } = await supabase
    .from("organization_contact_import_rows")
    .select("id, row_number, email, full_name, profile_data, status, error, invitation_id")
    .eq("job_id", job.id)
    .eq("status", "pending")
    .order("row_number", { ascending: true })
    .limit(batchSize);

  if (pendingRowsError) {
    await supabase
      .from("organization_contact_import_jobs")
      .update({
        status: "failed",
        last_error: pendingRowsError.message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return {
      success: false,
      error: "Failed to fetch pending import rows.",
    };
  }

  const pendingRows = (pendingRowsData || []) as ContactImportRowRow[];

  if (pendingRows.length === 0) {
    const { data: completedJobData } = await supabase
      .from("organization_contact_import_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .select(
        "id, organization_id, created_by, source_file_name, source_file_type, role, status, total_rows, valid_rows, invalid_rows, duplicate_rows, processed_rows, successful_invites, failed_invites, started_at, completed_at, last_error, created_at, updated_at",
      )
      .single();

    return {
      success: true,
      job: completedJobData ? toJob(completedJobData as ContactImportJobRow) : toJob(job),
      batch: {
        processed: 0,
        invited: 0,
        skipped: 0,
        failed: 0,
      },
    };
  }

  const { data: existingMembers } = await supabase
    .from("organization_members")
    .select("profiles(email)")
    .eq("organization_id", job.organization_id);

  const existingMemberEmails = new Set(
    (existingMembers || [])
      .map((member) => {
        const profile = member.profiles as { email: string } | { email: string }[] | null;
        if (Array.isArray(profile)) {
          return profile[0]?.email?.toLowerCase();
        }
        return profile?.email?.toLowerCase();
      })
      .filter((email): email is string => Boolean(email)),
  );

  const { data: pendingInvitations } = await supabase
    .from("organization_invitations")
    .select("email")
    .eq("organization_id", job.organization_id)
    .eq("status", "pending");

  const pendingInvitationEmails = new Set(
    (pendingInvitations || [])
      .map((invitation) => invitation.email?.toLowerCase())
      .filter((email): email is string => Boolean(email)),
  );

  let invitedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let lastErrorMessage: string | null = null;

  const failedRowsPreview: Array<{
    row_number: number;
    email: string;
    error: string | null;
    status: "failed" | "skipped";
  }> = [];

  for (const row of pendingRows) {
    const lowerEmail = row.email.toLowerCase();

    const markRow = async (status: "invited" | "skipped" | "failed", error: string | null, invitationId?: string) => {
      await supabase
        .from("organization_contact_import_rows")
        .update({
          status,
          error,
          invitation_id: invitationId ?? null,
        })
        .eq("id", row.id);
    };

    if (existingMemberEmails.has(lowerEmail)) {
      const reason = "Already a member of this organization";
      await markRow("skipped", reason);
      skippedCount++;
      failedRowsPreview.push({
        row_number: row.row_number,
        email: row.email,
        error: reason,
        status: "skipped",
      });
      continue;
    }

    if (pendingInvitationEmails.has(lowerEmail)) {
      const reason = "Already has a pending invitation";
      await markRow("skipped", reason);
      skippedCount++;
      failedRowsPreview.push({
        row_number: row.row_number,
        email: row.email,
        error: reason,
        status: "skipped",
      });
      continue;
    }

    const { data: invitationData, error: invitationError } = await supabase
      .from("organization_invitations")
      .insert({
        organization_id: job.organization_id,
        import_job_id: job.id,
        email: lowerEmail,
        role: job.role,
        invited_by: job.created_by,
        expires_at: expiresAtIso,
      })
      .select("id, token")
      .single();

    if (invitationError || !invitationData) {
      const reason = invitationError?.message || "Failed to create invitation record";
      await markRow("failed", reason);
      failedCount++;
      lastErrorMessage = reason;
      failedRowsPreview.push({
        row_number: row.row_number,
        email: row.email,
        error: reason,
        status: "failed",
      });
      continue;
    }

    const inviteUrl = `${baseUrl}/organization/join/invite?token=${invitationData.token}`;
    const emailResult = await sendEmail({
      to: lowerEmail,
      subject: `You're invited to join ${organization.name} on Let's Assist`,
      react: OrganizationInvitation({
        organizationName: organization.name,
        organizationUsername: organization.username,
        inviterName,
        recipientName: row.full_name,
        role: job.role,
        inviteUrl,
        expiresAt: expiresAtDisplay,
      }),
      type: "transactional",
    });

    if (!emailResult.success && !emailResult.skipped) {
      const reason = "Invitation email could not be sent";

      await supabase
        .from("organization_invitations")
        .update({ status: "cancelled" })
        .eq("id", invitationData.id);

      await markRow("failed", reason, invitationData.id);
      failedCount++;
      lastErrorMessage = reason;
      failedRowsPreview.push({
        row_number: row.row_number,
        email: row.email,
        error: reason,
        status: "failed",
      });
      continue;
    }

    await markRow("invited", null, invitationData.id);
    invitedCount++;
    pendingInvitationEmails.add(lowerEmail);
  }

  const { count: remainingPendingRows } = await supabase
    .from("organization_contact_import_rows")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id)
    .eq("status", "pending");

  const nextStatus: ContactImportJobRow["status"] =
    (remainingPendingRows || 0) === 0 ? "completed" : "pending";

  const { data: updatedJobData, error: updateJobError } = await supabase
    .from("organization_contact_import_jobs")
    .update({
      status: nextStatus,
      processed_rows: Math.min(job.processed_rows + pendingRows.length, job.valid_rows),
      successful_invites: job.successful_invites + invitedCount,
      failed_invites: job.failed_invites + failedCount + skippedCount,
      completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
      last_error: lastErrorMessage,
    })
    .eq("id", job.id)
    .select(
      "id, organization_id, created_by, source_file_name, source_file_type, role, status, total_rows, valid_rows, invalid_rows, duplicate_rows, processed_rows, successful_invites, failed_invites, started_at, completed_at, last_error, created_at, updated_at",
    )
    .single();

  if (updateJobError || !updatedJobData) {
    return {
      success: false,
      error: updateJobError?.message || "Failed to update import job progress.",
    };
  }

  return {
    success: true,
    job: toJob(updatedJobData as ContactImportJobRow),
    batch: {
      processed: pendingRows.length,
      invited: invitedCount,
      skipped: skippedCount,
      failed: failedCount,
    },
    failedRowsPreview: failedRowsPreview.slice(0, 25),
  };
}

export async function importContactsDirectFromFile(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  role: ContactImportRole;
  file: File;
}): Promise<
  ContactImportCreateResponse & {
    mode: "direct";
    directResult: BulkInviteResponse;
  }
> {
  const { supabase, organizationId, userId, role, file } = params;

  const admin = await isOrgAdmin(supabase, organizationId, userId);
  if (!admin) {
    const deniedResult: BulkInviteResponse = {
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
    };

    return {
      success: false,
      error: "Only organization admins can run contact imports.",
      mode: "direct",
      directResult: deniedResult,
    };
  }

  const organization = await getOrganizationContext(supabase, organizationId);
  if (!organization) {
    const missingOrgResult: BulkInviteResponse = {
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
    };

    return {
      success: false,
      error: "Organization not found.",
      mode: "direct",
      directResult: missingOrgResult,
    };
  }

  let parsed;
  try {
    parsed = await parseContactImportFile(file);
  } catch (error) {
    return {
      success: false,
      mode: "direct",
      directResult: {
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
      },
      error: error instanceof Error ? error.message : "Failed to parse uploaded file.",
    };
  }

  if (parsed.rows.length === 0) {
    const emptyResult: BulkInviteResponse = {
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
    };

    return {
      success: true,
      mode: "direct",
      directResult: emptyResult,
      parseSummary: parsed.summary,
      invalidRowsPreview: parsed.invalidRows.slice(0, 25),
      message: "No valid contacts were found in the uploaded file.",
    };
  }

  const inviterName = await getInviterName(supabase, userId);
  const baseUrl = getBaseUrl();
  const { expiresAtIso, expiresAtDisplay } = getExpirationDetails();

  const { data: existingMembers } = await supabase
    .from("organization_members")
    .select("profiles(email)")
    .eq("organization_id", organization.id);

  const existingMemberEmails = new Set(
    (existingMembers || [])
      .map((member) => {
        const profile = member.profiles as { email: string } | { email: string }[] | null;
        if (Array.isArray(profile)) {
          return profile[0]?.email?.toLowerCase();
        }
        return profile?.email?.toLowerCase();
      })
      .filter((email): email is string => Boolean(email)),
  );

  const { data: pendingInvitations } = await supabase
    .from("organization_invitations")
    .select("email")
    .eq("organization_id", organization.id)
    .eq("status", "pending");

  const pendingInvitationEmails = new Set(
    (pendingInvitations || [])
      .map((invitation) => invitation.email?.toLowerCase())
      .filter((email): email is string => Boolean(email)),
  );

  const results: BulkInviteResult[] = [];
  let successful = 0;
  let failed = 0;

  for (const row of parsed.rows) {
    const lowerEmail = row.email.toLowerCase();

    if (existingMemberEmails.has(lowerEmail)) {
      results.push({
        email: lowerEmail,
        success: false,
        error: "Already a member of this organization",
      });
      failed++;
      continue;
    }

    if (pendingInvitationEmails.has(lowerEmail)) {
      results.push({
        email: lowerEmail,
        success: false,
        error: "Already has a pending invitation",
      });
      failed++;
      continue;
    }

    const { data: invitationData, error: invitationError } = await supabase
      .from("organization_invitations")
      .insert({
        organization_id: organization.id,
        email: lowerEmail,
        role,
        invited_by: userId,
        expires_at: expiresAtIso,
      })
      .select("id, token")
      .single();

    if (invitationError || !invitationData) {
      results.push({
        email: lowerEmail,
        success: false,
        error: invitationError?.message || "Failed to create invitation",
      });
      failed++;
      continue;
    }

    const inviteUrl = `${baseUrl}/organization/join/invite?token=${invitationData.token}`;

    const emailResult = await sendEmail({
      to: lowerEmail,
      subject: `You're invited to join ${organization.name} on Let's Assist`,
      react: OrganizationInvitation({
        organizationName: organization.name,
        organizationUsername: organization.username,
        inviterName,
        recipientName: row.fullName,
        role,
        inviteUrl,
        expiresAt: expiresAtDisplay,
      }),
      type: "transactional",
    });

    if (!emailResult.success && !emailResult.skipped) {
      await supabase
        .from("organization_invitations")
        .update({ status: "cancelled" })
        .eq("id", invitationData.id);

      results.push({
        email: lowerEmail,
        success: false,
        error: "Invitation email could not be sent",
        invitationId: invitationData.id,
      });
      failed++;
      continue;
    }

    results.push({
      email: lowerEmail,
      success: true,
      invitationId: invitationData.id,
    });
    successful++;
    pendingInvitationEmails.add(lowerEmail);
  }

  const directResult: BulkInviteResponse = {
    total: parsed.rows.length,
    successful,
    failed,
    results,
  };

  return {
    success: true,
    mode: "direct",
    directResult,
    parseSummary: parsed.summary,
    invalidRowsPreview: parsed.invalidRows.slice(0, 25),
    message: "Import processed directly without background jobs.",
  };
}
