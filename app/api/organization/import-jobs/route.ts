import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  createContactImportJobFromFile,
  importContactsDirectFromFile,
} from "@/lib/organization/contact-import-jobs";

const SUPPORTED_ROLES = new Set(["staff", "member"]);

function shouldFallbackToDirectImport(errorMessage?: string): boolean {
  if (!errorMessage) {
    return false;
  }

  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("organization_contact_import_jobs") &&
    (normalized.includes("schema cache") ||
      normalized.includes("relation") ||
      normalized.includes("does not exist"))
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const organizationId = String(formData.get("organizationId") || "").trim();
    const roleRaw = String(formData.get("role") || "member").trim().toLowerCase();
    const role = SUPPORTED_ROLES.has(roleRaw) ? (roleRaw as "staff" | "member") : null;
    const file = formData.get("file");

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: "organizationId is required" },
        { status: 400 },
      );
    }

    if (!role) {
      return NextResponse.json(
        { success: false, error: "role must be either 'staff' or 'member'" },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "A CSV or Excel file is required." },
        { status: 400 },
      );
    }

    const useJobsMode = process.env.CONTACT_IMPORT_USE_JOBS === "true";

    if (!useJobsMode) {
      const direct = await importContactsDirectFromFile({
        supabase,
        organizationId,
        userId: user.id,
        role,
        file,
      });

      return NextResponse.json(direct, {
        status: direct.success ? 200 : 400,
      });
    }

    const result = await createContactImportJobFromFile({
      supabase,
      organizationId,
      userId: user.id,
      role,
      file,
    });

    if (!result.success && shouldFallbackToDirectImport(result.error)) {
      const fallback = await importContactsDirectFromFile({
        supabase,
        organizationId,
        userId: user.id,
        role,
        file,
      });

      return NextResponse.json(fallback, {
        status: fallback.success ? 200 : 400,
      });
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (error) {
    console.error("Error creating contact import job:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { user } = await getAuthUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");

    if (!organizationId) {
      return NextResponse.json(
        { success: false, error: "organizationId query param is required" },
        { status: 400 },
      );
    }

    const { data: adminMembership } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .single();

    if (adminMembership?.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Only organization admins can access import jobs." },
        { status: 403 },
      );
    }

    const { data: jobs, error } = await supabase
      .from("organization_contact_import_jobs")
      .select(
        "id, organization_id, created_by, source_file_name, source_file_type, role, status, total_rows, valid_rows, invalid_rows, duplicate_rows, processed_rows, successful_invites, failed_invites, started_at, completed_at, last_error, created_at, updated_at",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, jobs: jobs || [] });
  } catch (error) {
    console.error("Error listing contact import jobs:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
