import type { getSlotDetails } from "@/utils/project";

export type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string | null;
  };
};

export type ExistingCheckIn = {
  id: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  schedule_id?: string | null;
};

// Define LookupResult type based on the server action's return structure
export type LookupResult = {
  success: boolean;
  found: boolean; // Indicates if any signup (anon or registered) was found for the email
  isRegistered: boolean; // Indicates if the found signup is linked to a registered user account
  signupId?: string; // ID of the signup record (could be anon or registered)
  message: string;
  error?: string;
};

export type SessionDetails = NonNullable<ReturnType<typeof getSlotDetails>> & {
  name?: string;
  date?: string;
};

export function parseAnonymousProfileLink(value: string): {
  anonymousSignupId: string;
  token: string;
} | null {
  try {
    const parsed = new URL(value.trim(), "https://lets-assist.invalid");
    const match = parsed.pathname.match(
      /^\/anonymous\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/confirm)?\/?$/iu,
    );
    const token = parsed.searchParams.get("token")?.trim();
    if (!match || !token) return null;
    return { anonymousSignupId: match[1], token };
  } catch {
    return null;
  }
}

// Helper function to format remaining time
export function formatRemainingTime(minutes: number): string {
  if (minutes <= 0) return "Session ended";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.ceil(minutes % 60); // Use Math.ceil to avoid off-by-one errors
  let result = "";
  if (hours > 0) {
    result += `${hours}h `;
  }
  // Ensure minutes are always shown, even if 0 when hours > 0
  if (remainingMinutes > 0 || hours === 0) {
    result += `${remainingMinutes}m`;
  }
  return result.trim(); // Trim potential trailing space if only hours exist (though unlikely with rounding)
}
