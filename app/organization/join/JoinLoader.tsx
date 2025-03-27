"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { joinOrganization } from "../actions";

interface JoinLoaderProps {
  organizationId: string;
  code: string;
  userId: string;
}

export default function JoinLoader({ code }: JoinLoaderProps) {
  const router = useRouter();

  useEffect(() => {
    const autoJoin = async () => {
      try {
        const result = await joinOrganization(code);
        
        if (result.error) {
          toast.error(result.error);
          router.push("/organization");
          return;
        }

        toast.success("Successfully joined the organization!");
        router.push(`/organization/${result.organizationUsername}`);
      } catch (error) {
        console.error("Error joining:", error);
        toast.error("Failed to join organization");
        router.push("/organization");
      }
    };

    autoJoin();
  }, [code, router]);

  return (
    <div className="text-center space-y-4">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      <p className="text-lg font-medium">Joining organization...</p>
      <p className="text-sm text-muted-foreground">Please wait while we process your request</p>
    </div>
  );
}
