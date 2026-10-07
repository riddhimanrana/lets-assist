"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { joinOrganization } from "../actions";
import { InviteCard, type InviteOrganization } from "./InviteCard";
import { joinedOrganizationPath } from "./join-result";

interface JoinLoaderProps {
  organizationId: string;
  code: string;
  userId: string;
  organization: InviteOrganization;
}

export default function JoinLoader({ code, organization }: JoinLoaderProps) {
  const router = useRouter();

  useEffect(() => {
    const autoJoin = async () => {
      try {
        const result = await joinOrganization(code);

        const destination = joinedOrganizationPath(result);
        if (destination) {
          if (result.success)
            toast.success("Successfully joined the organization!");
          router.push(destination);
          return;
        }

        if (result.error) {
          toast.error(result.error);
          router.push("/organization");
          return;
        }

        toast.error("Could not open the organization. Try again.");
        router.push("/organization");
      } catch (error) {
        console.error("Error joining:", error);
        toast.error("Failed to join organization");
        router.push("/organization");
      }
    };

    autoJoin();
  }, [code, router]);

  return (
    <InviteCard organization={organization}>
      <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
        <Spinner />
        Joining organization...
      </div>
    </InviteCard>
  );
}
