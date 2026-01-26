import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const BATCH_SIZE = 250;
const SIGNATURE_BUCKET = "waiver-signatures";
const UPLOAD_BUCKET = "waiver-uploads";

function authorizeCronRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 }),
    };
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true } as const;
}

async function cleanupExpiredWaivers() {
  const supabase = getAdminClient();
  const now = new Date().toISOString();

  const { data: signatures, error } = await supabase
    .from("waiver_signatures")
    .select("id, signature_storage_path, upload_storage_path")
    .lte("expires_at", now)
    .limit(BATCH_SIZE);

  if (error) {
    console.error("Error fetching expired waivers:", error);
    return { error: "Failed to load expired waivers" };
  }

  if (!signatures || signatures.length === 0) {
    return { deleted: 0 };
  }

  const signaturePaths = signatures
    .map((item) => item.signature_storage_path)
    .filter((path): path is string => Boolean(path));

  const uploadPaths = signatures
    .map((item) => item.upload_storage_path)
    .filter((path): path is string => Boolean(path));

  if (signaturePaths.length > 0) {
    const { error: signatureDeleteError } = await supabase.storage
      .from(SIGNATURE_BUCKET)
      .remove(signaturePaths);

    if (signatureDeleteError) {
      console.error("Error deleting waiver signatures from storage:", signatureDeleteError);
    }
  }

  if (uploadPaths.length > 0) {
    const { error: uploadDeleteError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .remove(uploadPaths);

    if (uploadDeleteError) {
      console.error("Error deleting waiver uploads from storage:", uploadDeleteError);
    }
  }

  const idsToDelete = signatures.map((item) => item.id);
  const { error: deleteError } = await supabase
    .from("waiver_signatures")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) {
    console.error("Error deleting waiver records:", deleteError);
    return { error: "Failed to delete waiver records" };
  }

  return { deleted: idsToDelete.length };
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await cleanupExpiredWaivers();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Waiver cleanup cron failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
