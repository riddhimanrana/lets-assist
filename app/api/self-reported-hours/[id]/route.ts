import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Validate auth (user must be logged in)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch the certificate to verify ownership
    const { data: certificate, error: fetchError } = await supabase
      .from("certificates")
      .select("id, user_id, type")
      .eq("id", id)
      .single();

    if (fetchError && fetchError.code === "PGRST116") {
      // Record not found
      return NextResponse.json(
        { error: "Certificate not found" },
        { status: 404 }
      );
    }

    if (fetchError) {
      console.error("Error fetching certificate:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch certificate" },
        { status: 500 }
      );
    }

    // Verify ownership - only the user who created the self-reported hours can delete
    if (certificate.user_id !== user.id) {
      return NextResponse.json(
        { error: "You can only delete your own self-reported hours" },
        { status: 403 }
      );
    }

    // Verify it's a self-reported certificate
    if (certificate.type !== "self-reported") {
      return NextResponse.json(
        { error: "Can only delete self-reported hours" },
        { status: 400 }
      );
    }

    // Delete the certificate
    const { error: deleteError } = await supabase
      .from("certificates")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Error deleting certificate:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete certificate" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Self-reported hours deleted successfully",
    });
  } catch (err) {
    console.error("Unexpected error in self-reported-hours DELETE:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
