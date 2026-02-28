"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

function QueryMessageToastContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;

    const deleted = searchParams.get("deleted");
    if (deleted === "true") {
      toast.success("Account successfully deleted", {
        description: "We're sorry to see you go. You can always create a new account later.",
        duration: 5000,
      });

      // Clear the search params from the URL without reloading
      const params = new URLSearchParams(searchParams.toString());
      params.delete("deleted");
      params.delete("noRedirect");
      
      const newQuery = params.toString() ? `?${params.toString()}` : "";
      router.replace(`${pathname}${newQuery}`, { scroll: false });
    }
  }, [mounted, searchParams, router, pathname]);

  return null;
}

export function QueryMessageToast() {
  return (
    <Suspense fallback={null}>
      <QueryMessageToastContent />
    </Suspense>
  );
}
