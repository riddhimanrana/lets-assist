import { resolveClientAuthOrigin } from "@/app/signup/request-origin";

type BrowserLocation = Pick<Location, "assign" | "host" | "origin">;

type GoogleIdentityAuth = {
  linkIdentity(options: {
    provider: "google";
    options: {
      redirectTo: string;
      queryParams: Record<string, string>;
    };
  }): Promise<{ error: unknown }>;
};

/** Client-side counterpart to `runOnCanonicalAuthOrigin`. */
export async function startGoogleIdentityLink(
  auth: GoogleIdentityAuth,
  browserLocation: BrowserLocation = window.location,
  options: { publicSiteUrl?: string; loginHint?: string } = {},
): Promise<{ redirected: boolean; error: unknown }> {
  const authOrigin = resolveClientAuthOrigin(
    options.publicSiteUrl ?? process.env.NEXT_PUBLIC_SITE_URL,
    browserLocation,
  );

  if (new URL(browserLocation.origin).origin !== authOrigin) {
    browserLocation.assign(
      new URL("/account/authentication", authOrigin).toString(),
    );
    return { redirected: true, error: null };
  }

  const { error } = await auth.linkIdentity({
    provider: "google",
    options: {
      redirectTo: `${authOrigin}/auth/callback?from=authentication`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        login_hint: options.loginHint ?? "",
      },
    },
  });

  return { redirected: false, error };
}
