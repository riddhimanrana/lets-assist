import { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getInvitationByToken } from "@/app/organization/[id]/admin/actions";
import InviteAcceptClient from "./InviteAcceptClient";

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
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
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-destructive/10 rounded-full p-4 w-16 h-16 mx-auto mb-4">
            <svg
              className="w-8 h-8 text-destructive mx-auto"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Invitation Not Found</h1>
          <p className="text-muted-foreground mb-6">
            This invitation link is invalid or has already been used.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Go to Homepage
          </Link>
        </div>
      </div>
    );
  }

  return <InviteAcceptClient invitation={invitation} token={token} />;
}
