"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Toaster, toast } from "sonner";

export function EmailVerificationToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const emailConfirmed = searchParams.get("confirmed");
    if (emailConfirmed === "true") {
      toast.success("Success! Email verified.", {
        duration: 5000,
      });
    }
  }, [searchParams]);

  return <Toaster position="bottom-right" theme="dark" richColors />;
}
