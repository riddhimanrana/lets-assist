import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InviteCard, type InviteOrganization } from "./InviteCard";

interface JoinSignInCardProps {
  organization: InviteOrganization;
  joinCode: string;
}

/** Signed-out view of a join-code link: sign in or sign up, then come back. */
export default function JoinSignInCard({
  organization,
  joinCode,
}: JoinSignInCardProps) {
  return (
    <InviteCard
      organization={organization}
      description="You've been invited to join this organization. Sign in or create an account to continue."
      footer={
        <>
          <Button asChild>
            <Link href={`/login?redirect=/organization/join?code=${joinCode}`}>
              Sign in to join
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/signup?redirect=/organization/join?code=${joinCode}`}>
              Create account
            </Link>
          </Button>
        </>
      }
    />
  );
}
