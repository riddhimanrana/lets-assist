"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center bg-background px-4">
      <div className="text-center space-y-4 md:space-y-6">
      <h1 className="text-6xl md:text-9xl font-bold text-primary">404</h1>
      <div className="space-y-2">
        <h2 className="text-xl md:text-2xl font-semibold">Page Not Found</h2>
        <p className="text-sm md:text-base text-muted-foreground">
        Oops! The page you&apos;re looking for doesn&apos;t exist or has
        been moved.
        </p>
      </div>
      <Button onClick={() => router.push("/")} className="mt-4 md:mt-8">
        Return Home
      </Button>
      </div>
    </div>
  );
}
