import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncPrimaryUserEmail } from "@/lib/auth/primary-email";
import { redirect } from "next/navigation";
import { normalizeRedirectPath } from "@/app/signup/redirect-utils";
import { resolveAuthRedirectOrigin } from "@/app/signup/request-origin";

/**
 * `origin` is the validated auth redirect origin, never `new URL(request.url)`:
 * Next.js rebuilds `request.url` from the server's own binding, so on the
 * loopback stack it reads `http://localhost:<port>` even when the browser
 * confirmed on `http://127.0.0.1:<port>`. Redirecting there would hand the
 * verified account to a different cookie origin than the one that just
 * completed the PKCE exchange.
 */
async function redirectToSuccess(
  origin: string,
  email?: string,
  type: "signup" | "email_change" = "signup",
  redirectAfterAuth?: string | null,
) {
  const redirectUrl = new URL(`${origin}/auth/verification-success`);
  redirectUrl.searchParams.set("type", type);
  if (email) {
    redirectUrl.searchParams.set("email", email);
  }
  if (redirectAfterAuth) {
    redirectUrl.searchParams.set("redirectAfterAuth", redirectAfterAuth);
  }
  redirect(redirectUrl.toString());
}

function redirectToError(origin: string, message?: string) {
  const errorUrl = new URL("/error", origin);
  if (message) errorUrl.searchParams.set("message", message);
  redirect(errorUrl.toString());
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const token = searchParams.get("token");
  const email = searchParams.get("email") ?? undefined;
  const typeParam = (searchParams.get("type") as EmailOtpType | null) ?? null;
  const type: EmailOtpType = typeParam ?? "signup";
  const code = searchParams.get("code");
  const redirectAfterAuth = normalizeRedirectPath(
    searchParams.get("redirectAfterAuth"),
  );
  const authOrigin = resolveAuthRedirectOrigin(request.headers.get("host"));

  const isExpiredLinkError = (message: string) => {
    const lowered = message.toLowerCase();
    return (
      lowered.includes("expired") ||
      lowered.includes("otp") ||
      lowered.includes("token")
    );
  };

  const redirectToExpiredLink = () => {
    const url = new URL("/auth/email-expired", authOrigin);
    if (email) {
      url.searchParams.set("email", email);
    }
    redirect(url.toString());
  };

  const isPkceVerifierMissingError = (
    message?: string,
    code?: string | null,
  ) => {
    const lowered = (message ?? "").toLowerCase();
    return (
      code === "pkce_code_verifier_not_found" ||
      lowered.includes("pkce code verifier not found")
    );
  };

  const getTrustedUser = async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.error("Trusted user lookup failed during confirmation:", error);
      return null;
    }

    return user;
  };

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Code exchange error:", error);
      if (
        type === "signup" &&
        isPkceVerifierMissingError(error.message, error.code)
      ) {
        return redirectToExpiredLink();
      }
      if (type === "signup" && isExpiredLinkError(error.message ?? "")) {
        return redirectToExpiredLink();
      }
      return redirectToError(authOrigin, error.message);
    }

    const trustedUser = await getTrustedUser();
    if (!trustedUser) {
      return redirectToError(authOrigin, "Unable to load verified user");
    }

    const primarySync = await syncPrimaryUserEmail(trustedUser.id);
    if (!primarySync.success) {
      console.error(
        "Primary email synchronization failed after code exchange:",
        primarySync.status,
      );
      return redirectToError(
        authOrigin,
        "Unable to synchronize verified email",
      );
    }

    const userEmail = trustedUser.email;
    await supabase.auth.signOut();
    return redirectToSuccess(
      authOrigin,
      userEmail,
      type === "email_change" ? "email_change" : "signup",
      redirectAfterAuth,
    );
  }

  if (!token_hash && !token && !code) {
    console.warn("Confirmation hit without a verification credential");
    return redirectToError(authOrigin, "Missing verification credential");
  }

  const tokenValue = token_hash ?? token;

  if (!tokenValue) {
    console.error("Missing token for verification");
    return redirectToError(authOrigin);
  }

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenValue,
  });

  if (error) {
    console.error("Verification error:", error);
    if (type === "signup" && isExpiredLinkError(error.message ?? "")) {
      return redirectToExpiredLink();
    }
    return redirectToError(authOrigin, error.message);
  }

  const trustedUser = await getTrustedUser();

  if (!trustedUser) {
    return redirectToError(authOrigin, "Unable to load verified user");
  }

  const primarySync = await syncPrimaryUserEmail(trustedUser.id);
  if (!primarySync.success) {
    console.error(
      "Primary email synchronization failed after confirmation:",
      primarySync.status,
    );
    return redirectToError(authOrigin, "Unable to synchronize verified email");
  }

  if (type === "email_change") {
    return redirectToSuccess(
      authOrigin,
      trustedUser.email,
      "email_change",
      redirectAfterAuth,
    );
  }

  const userEmail = trustedUser.email;
  await supabase.auth.signOut();
  return redirectToSuccess(authOrigin, userEmail, "signup", redirectAfterAuth);
}
