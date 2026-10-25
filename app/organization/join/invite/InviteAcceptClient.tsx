"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { CheckCircle2, XCircle } from "lucide-react";
import { InviteCard, InviteShell } from "../InviteCard";
import { acceptInvitation } from "@/app/organization/[id]/admin/actions";
import type { OrganizationInvitationWithDetails } from "@/types/invitation";
import { createClient } from "@/lib/supabase/client";

interface InviteAcceptClientProps {
  invitation: OrganizationInvitationWithDetails;
  token: string;
}

export default function InviteAcceptClient({
  invitation,
  token,
}: InviteAcceptClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const org = invitation.organization as
    { name: string; username: string; logo_url: string | null } | undefined;
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
    };
    checkAuth();

    // Listen for auth changes
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
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
      <InviteShell>
        <Spinner className="text-muted-foreground size-6" />
      </InviteShell>
    );
  }

  // Show success state
  if (success) {
    return (
      <InviteShell>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2 className="text-success" />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>
              Welcome to {org?.name}!
            </EmptyTitle>
            <EmptyDescription>
              You&apos;ve successfully joined as a {invitation.role}.
              Redirecting you now...
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </InviteShell>
    );
  }

  // Show error state for expired/used invitations
  if (isExpired || isAlreadyUsed) {
    return (
      <InviteShell>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <XCircle />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>
              {isExpired ? "Invitation expired" : "Invitation already used"}
            </EmptyTitle>
            <EmptyDescription>
              {isExpired
                ? "This invitation has expired. Please contact the organization administrator for a new invitation."
                : `This invitation has already been ${invitation.status}.`}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/">Go to homepage</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <InviteCard
        organization={org}
        badge={
          <Badge
            variant={invitation.role === "staff" ? "default" : "secondary"}
            className="capitalize"
          >
            {invitation.role}
          </Badge>
        }
        description={
          invitation.role === "staff"
            ? "As a staff member, you'll be able to verify volunteer hours and help manage organization activities."
            : "As a member, you'll be able to take part in volunteer opportunities and track your community service hours."
        }
        footer={
          isAuthenticated ? (
            <>
              <Button onClick={handleAccept} disabled={isPending}>
                {isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Accepting...
                  </>
                ) : (
                  "Accept Invitation"
                )}
              </Button>
              <Button variant="outline" asChild>
                <Link href="/">Decline</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild>
                <Link href={authLinks.login}>Sign in</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={authLinks.signup}>Sign up</Link>
              </Button>
            </>
          )
        }
      >
        <p className="text-muted-foreground text-center text-sm">
          Invitation expires {formatDate(invitation.expires_at)}
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!isAuthenticated && (
          <Alert>
            <AlertDescription>
              Please sign in or create an account with{" "}
              <strong>{invitedEmail}</strong> to accept this invitation.
            </AlertDescription>
          </Alert>
        )}
      </InviteCard>
    </InviteShell>
  );
}
