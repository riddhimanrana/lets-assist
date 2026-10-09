import { createClient } from "@/lib/supabase/server";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SubmitTrustedMemberForm } from "@/app/trusted-member/submit-form";
import { ShieldCheck, XCircle, Clock } from "lucide-react";

// export const dynamic = "force-dynamic"; - incompatible with cacheComponents

export const metadata: Metadata = {
  title: "Trusted member",
  description:
    "Apply to become a trusted member to create projects and organizations.",
};

export default async function TrustedMemberPage() {
  const supabase = await createClient();
  // @ts-ignore - getClaims exists in GoTrueClient but types might be outdated
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims) {
    redirect("/login?redirect=/trusted-member");
  }

  const userId = claimsData.claims.sub;
  // If no sub, treat as unauthenticated
  if (!userId) {
    redirect("/login?redirect=/trusted-member");
  }

  // Fetch profile trusted flag
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, trusted_member")
    .eq("id", userId)
    .single();

  // Fetch application row (status: null=pending, true=accepted, false=denied)
  const { data: appRow } = await supabase
    .from("trusted_member")
    .select("id, status, name, email, created_at")
    .eq("id", userId)
    .maybeSingle();

  const isTrusted = !!profile?.trusted_member;
  const status: boolean | null | undefined = appRow?.status;
  const hasApplication = !!appRow; // Treat any row as an existing application

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Trusted member"
        description="Trusted members can create projects and organizations on Let's Assist."
      />

      {isTrusted || status === true ? (
        <Alert variant="success">
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>You&apos;re a trusted member</AlertTitle>
          <AlertDescription>
            You already have access to create projects and organizations.
          </AlertDescription>
        </Alert>
      ) : hasApplication && status === false ? (
        <Alert variant="destructive">
          <XCircle aria-hidden="true" />
          <AlertTitle>Application not approved</AlertTitle>
          <AlertDescription>
            It looks like your trusted member application was not approved. If
            you have questions or need help, please email
            support@lets-assist.com.
          </AlertDescription>
        </Alert>
      ) : hasApplication ? (
        <Alert variant="info">
          <Clock aria-hidden="true" />
          <AlertTitle>Application pending review</AlertTitle>
          <AlertDescription>
            <p>
              Your application is currently pending. We will contact you at your
              email with further details once it is reviewed.
            </p>
            {appRow?.created_at ? (
              <p>
                Submitted on{" "}
                {new Date(appRow.created_at as string).toLocaleDateString()}
              </p>
            ) : null}
            <p>
              If you need any help, reach out to{" "}
              <a
                className="underline underline-offset-4"
                href="mailto:support@lets-assist.com"
              >
                support@lets-assist.com
              </a>
              .
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <SubmitTrustedMemberForm
          defaultName={profile?.full_name || ""}
          defaultEmail={profile?.email || ""}
        />
      )}
    </div>
  );
}
