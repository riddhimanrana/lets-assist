import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { resolvePostAuthRedirectPath } from "@/lib/auth/mfa";

import MfaChallengeClient from "./MfaChallengeClient";

export const metadata: Metadata = {
  title: "Verify Sign-In",
  description:
    "Complete authenticator verification to continue to your Let's Assist account.",
};

type MfaPageProps = {
  searchParams: Promise<{ redirect?: string }>;
};

export default async function MfaPage({ searchParams }: MfaPageProps) {
  const resolvedSearchParams = await searchParams;
  const redirectPath = resolvePostAuthRedirectPath(
    resolvedSearchParams.redirect,
  );

  const { user } = await getAuthUser({ allowMfaPending: true });

  if (!user) {
    const loginUrl =
      redirectPath === "/home"
        ? "/login"
        : `/login?redirect=${encodeURIComponent(redirectPath)}`;

    redirect(loginUrl);
  }

  return (
    <MfaChallengeClient
      redirectPath={redirectPath}
      email={user.email ?? null}
    />
  );
}