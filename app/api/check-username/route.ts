import { NextResponse } from "next/server";
import { checkUsernameUnique } from "@/app/account/profile/actions";

export const runtime = "edge"; // run on edge runtime

export const GET = async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 },
      );
    }

    const usernameLc = username.toLowerCase();
    const result = await checkUsernameUnique(usernameLc);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
};
