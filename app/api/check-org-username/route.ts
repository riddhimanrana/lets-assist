import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get("username");

  if (!username) {
    return NextResponse.json(
      { error: "Username parameter is required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("username")
      .eq("username", username)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 is the error code for "No rows returned" which is what we want
      console.error("Error checking organization username:", error);
      return NextResponse.json(
        { error: "Error checking username" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      available: !data, // If data is null, the username is available
    });
  } catch (error) {
    console.error("Unexpected error checking organization username:", error);
    return NextResponse.json(
      { error: "Unexpected error checking username" },
      { status: 500 }
    );
  }
}
