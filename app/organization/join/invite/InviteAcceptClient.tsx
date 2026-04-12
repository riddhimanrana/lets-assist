"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, Building2, Clock, User } from "lucide-react";
import { acceptInvitation } from "@/app/organization/[id]/admin/actions";
import type { OrganizationInvitationWithDetails } from "@/types/invitation";
import { createClient } from "@/lib/supabase/client";

interface InviteAcceptClientProps {
  invitation: OrganizationInvitationWithDetails;
  token: string;
}

export default function InviteAcceptClient({ invitation, token }: InviteAcceptClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const org = invitation.organization as { name: string; username: string; logo_url: string | null } | undefined;
  const inviter = invitation.inviter as { full_name: string | null; email: string | null } | undefined;
  const invitedEmail = invitation.email?.trim() || "";

  const authLinks = useMemo(() => {
    const params = new URLSearchParams();
    params.set("invite_token", token);
    params.set("member_token", token);

    if (org?.username) {
      params.set("org", org.username);
    }

    if (invitedEmail) {
      params.set("email", invitedEmail);
    }

    const query = params.toString();

    return {
      login: `/login?${query}`,
      signup: `/signup?${query}`,
    };
  }, [invitedEmail, org?.username, token]);

  const isExpired = new Date(invitation.expires_at) < new Date();
  const isAlreadyUsed = invitation.status !== "pending";

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
    };
    checkAuth();

    // Listen for auth changes
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.user);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(token);

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push(result.redirectUrl || `/organization/${org?.username}`);
        }, 1500);
      } else {
        setError(result.error || "Something went wrong");
      }
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  // Show loading while checking auth
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-green-100 dark:bg-green-900/20 rounded-full p-4 w-16 h-16 mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400 mx-auto" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Welcome to {org?.name}!</h1>
          <p className="text-muted-foreground mb-4">
            You've successfully joined as a {invitation.role}.
          </p>
          <p className="text-sm text-muted-foreground">Redirecting you now...</p>
        </div>
      </div>
    );
  }

  // Show error state for expired/used invitations
  if (isExpired || isAlreadyUsed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-destructive/10 rounded-full p-4 w-16 h-16 mx-auto mb-4">
            <XCircle className="w-8 h-8 text-destructive mx-auto" />
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {isExpired ? "Invitation Expired" : "Invitation Already Used"}
          </h1>
          <p className="text-muted-foreground mb-6">
            {isExpired
              ? "This invitation has expired. Please contact the organization administrator for a new invitation."
              : `This invitation has already been ${invitation.status}.`}
          </p>
          <Button asChild>
            <Link href="/">Go to Homepage</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center pb-2">
          {org?.logo_url ? (
            <Avatar className="h-16 w-16 mx-auto mb-2">
              <AvatarImage src={org.logo_url} alt={org.name} />
              <AvatarFallback>
                <Building2 className="h-8 w-8" />
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="bg-primary/10 rounded-full p-4 w-16 h-16 mx-auto mb-2">
              <Building2 className="h-8 w-8 text-primary mx-auto" />
            </div>
          )}
          <CardTitle className="text-2xl">You're Invited!</CardTitle>
          <CardDescription>
            {inviter?.full_name || inviter?.email || "Someone"} invited you to join{" "}
            <strong>{org?.name}</strong>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Role Badge */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm text-muted-foreground">You'll join as:</span>
            <Badge variant={invitation.role === "staff" ? "default" : "secondary"} className="capitalize">
              {invitation.role}
            </Badge>
          </div>

          {/* Details */}
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Organization: {org?.name}</span>
            </div>
            {inviter && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Invited by: {inviter.full_name || inviter.email}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Expires: {formatDate(invitation.expires_at)}</span>
            </div>
          </div>

          {/* Role Description */}
          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            {invitation.role === "staff" ? (
              <p>
                As a <strong>staff member</strong>, you'll have elevated permissions including the
                ability to verify volunteer hours and help manage organization activities.
              </p>
            ) : (
              <p>
                As a <strong>member</strong>, you'll be able to participate in volunteer
                opportunities and track your community service hours.
              </p>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          {isAuthenticated ? (
            <div className="space-y-3">
              <Button onClick={handleAccept} disabled={isPending} className="w-full" size="lg">
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Accepting...
                  </>
                ) : (
                  "Accept Invitation"
                )}
              </Button>
              <Button variant="outline" asChild className="w-full">
                <Link href="/">Decline</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Please sign in or create an account with <strong>{invitedEmail}</strong> to accept this invitation.
                </AlertDescription>
              </Alert>
              <div className="grid grid-cols-2 gap-3">
                <Button asChild>
                  <Link href={authLinks.login}>
                    Sign In
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href={authLinks.signup}>
                    Sign Up
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
