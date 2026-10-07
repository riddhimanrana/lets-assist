import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getInvitationByToken } from "@/app/organization/[id]/admin/actions";
import { CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InviteShell } from "../InviteCard";
import InviteAcceptClient from "./InviteAcceptClient";

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const { token } = await searchParams;

  if (!token) {
    return {
      title: "Invalid Invitation",
      description: "This invitation link is invalid.",
    };
  }

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return {
      title: "Invitation Not Found",
      description: "This invitation could not be found.",
    };
  }

  const org = invitation.organization as { name: string } | undefined;

  return {
    title: `Join ${org?.name || "Organization"} | Let's Assist`,
    description: `You've been invited to join ${org?.name || "an organization"} on Let's Assist.`,
  };
}

export default async function InviteAcceptPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    redirect("/");
  }

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return (
      <InviteShell>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleX />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={1}>
              Invitation Not Found
            </EmptyTitle>
            <EmptyDescription>
              This invitation link is invalid or has already been used.
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

  return <InviteAcceptClient invitation={invitation} token={token} />;
}
