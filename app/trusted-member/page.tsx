import { createClient } from "@/utils/supabase/server";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { SubmitTrustedMemberForm } from "@/app/trusted-member/submit-form";
import { Shield, ShieldCheck, XCircle, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trusted Member",
  description: "Apply to become a Trusted Member to create projects and organizations.",
};

export default async function TrustedMemberPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/trusted-member");
  }

  // Fetch profile trusted flag
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, trusted_member")
    .eq("id", user.id)
    .single();

  // Fetch application row (status: null=pending, true=accepted, false=denied)
  const { data: appRow } = await supabase
    .from("trusted_member")
    .select("id, status, name, email, created_at")
    .eq("id", user.id)
    .maybeSingle();

  const isTrusted = !!profile?.trusted_member;
  const status: boolean | null | undefined = appRow?.status;
  const hasApplication = !!appRow; // Treat any row as an existing application

  return (
    <div className="container max-w-2xl py-6 px-4 mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Trusted Member</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Trusted Members can create projects and organizations on Let&apos;s Assist.
        </p>
      </div>

      <Separator className="mb-6" />

      {isTrusted || status === true ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-chart-5" />
              <Badge variant="default">All set</Badge>
              <span className="font-semibold">You&apos;re a Trusted Member</span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You already have access to create projects and organizations.
            </p>
          </CardContent>
        </Card>
      ) : hasApplication && status === false ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <Badge variant="secondary">Denied</Badge>
              <span className="font-semibold">Application not approved</span>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              It looks like your Trusted Member application was not approved. If you have questions or need help, please email support@lets-assist.com.
            </p>
          </CardContent>
        </Card>
      ) : hasApplication ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <Badge variant="outline">Pending</Badge>
              <span className="font-semibold">Application pending review</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Your application is currently pending. We will contact you at your email with further details once it is reviewed.
              </p>
              {appRow?.created_at ? (
                <p className="text-xs text-muted-foreground">
                  Submitted on {new Date(appRow.created_at as string).toLocaleDateString()}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                If you need any help, reach out to <a className="underline" href="mailto:support@lets-assist.com">support@lets-assist.com</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <SubmitTrustedMemberForm
          defaultName={profile?.full_name || ""}
          defaultEmail={profile?.email || ""}
        />
      )}
    </div>
  );
}
