import { NextResponse } from "next/server";
import { checkUsernameUnique } from "@/app/account/profile/actions";
import { USERNAME_REGEX } from "@/schemas/onboarding-schema";
import { checkOffensiveLanguage } from "@/utils/moderation-helpers";

export const runtime = "edge"; // run on edge runtime

export const GET = async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username) {
      return NextResponse.json(
        { available: false, error: "Username is required" },
        { status: 400 },
      );
    }

    if (username.length < 3) {
      return NextResponse.json(
        { available: false, error: "Username must be at least 3 characters" },
        { status: 200 },
      );
    }

    if (!USERNAME_REGEX.test(username)) {
      return NextResponse.json(
        { available: false, error: "Username can only contain letters, numbers, underscores, dots and hyphens" },
        { status: 200 },
      );
    }

    const usernameLc = username.toLowerCase();

    // Fast profanity check
    const profanityResult = await checkOffensiveLanguage(usernameLc);
    if (profanityResult.isProfane) {
      return NextResponse.json({
        available: false,
        error: profanityResult.error || "This username contains inappropriate language"
      });
    }

    const result = await checkUsernameUnique(usernameLc);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
};
