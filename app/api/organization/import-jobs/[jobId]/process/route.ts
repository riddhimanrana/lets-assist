import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { processContactImportJobBatch } from "@/lib/organization/contact-import-jobs";

function parseBatchSize(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const queryBatchSize = parseBatchSize(url.searchParams.get("batchSize"));

    let bodyBatchSize: number | undefined;
    try {
      const body = (await request.json()) as { batchSize?: number };
      if (typeof body.batchSize === "number") {
        bodyBatchSize = body.batchSize;
      }
    } catch {
      // Request body is optional.
    }

    const result = await processContactImportJobBatch({
      supabase,
      jobId,
      userId: user.id,
      batchSize: bodyBatchSize ?? queryBatchSize,
    });

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (error) {
    console.error("Error processing contact import batch:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
