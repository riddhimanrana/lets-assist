"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { redeemAttendanceChallenge } from "./actions";
import { Loader2, AlertTriangle, Smartphone } from "lucide-react"; // Added Smartphone icon
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface PrepareClientProps {
  projectId: string;
}

export default function PrepareClient({ projectId }: PrepareClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    // --- Device Check ---
    const userAgent = navigator.userAgent;
    const isMobileDevice = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);

    if (!isMobileDevice) {
      console.warn(
        "PrepareClient: Access attempt from non-mobile device:",
        userAgent,
      );
      setErrorMessage(
        "Please scan the QR code using your mobile device camera.",
      );
      setStatus("error");
      return; // Stop execution if not mobile
    }
    // --- End Device Check ---

    const challenge = searchParams.get("challenge");

    console.log("PrepareClient: Raw URL params:", {
      hasChallenge: Boolean(challenge),
      fullURL: window.location.href,
    });

    if (!challenge) {
      setErrorMessage("This QR code is missing its attendance challenge.");
      setStatus("error");
      return;
    }

    const setCookieAndRedirect = async () => {
      try {
        const result = await redeemAttendanceChallenge(projectId, challenge);

        if (result.success) {
          console.log(
            "PrepareClient: Cookie set successfully. Redirecting client-side...",
          );
          setStatus("success");
          router.replace(
            `/attend/${encodeURIComponent(result.projectId)}?session=${encodeURIComponent(result.sessionId)}&schedule=${encodeURIComponent(result.scheduleId)}`,
          );
        } else {
          console.error(
            "PrepareClient: Failed to set cookie via server action.",
            result.error,
          );
          setErrorMessage(
            result.error ||
              "Failed to verify attendance link. Please try scanning the QR code again.",
          );
          setStatus("error");
        }
      } catch (error) {
        console.error("PrepareClient: Error calling server action.", error);
        setErrorMessage(
          "An unexpected error occurred. Please try scanning the QR code again.",
        );
        setStatus("error");
      }
    };

    // Use void to explicitly ignore the promise returned by the async function
    void setCookieAndRedirect();
    // Dependency array includes necessary values
  }, [projectId, router, searchParams]);

  // Render UI based on status
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-160px)] lg:min-h-[calc(100vh-64px)] bg-background">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="text-center">
            {status === "error" &&
            errorMessage ===
              "Please scan the QR code using your mobile device camera."
              ? "Device Not Supported"
              : "Verifying Attendance Link"}
          </CardTitle>
          <CardDescription className="text-center">
            {status !== "error" ||
            errorMessage !==
              "Please scan the QR code using your mobile device camera."
              ? "Please wait while we prepare your check-in..."
              : "This check-in process must be completed on a mobile device."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center space-y-4 min-h-[150px]">
          {status === "loading" && (
            <>
              <Loader2
                className="h-12 w-12 animate-spin text-primary"
                aria-label="Loading"
              />
              <p className="text-muted-foreground">Verifying...</p>
            </>
          )}
          {status === "success" && (
            <>
              <Loader2
                className="h-12 w-12 animate-spin text-primary"
                aria-label="Redirecting"
              />
              <p className="text-muted-foreground">Redirecting...</p>
            </>
          )}
          {status === "error" && (
            <div
              className="text-center text-destructive space-y-2"
              role="alert"
            >
              {errorMessage ===
              "Please scan the QR code using your mobile device camera." ? (
                <Smartphone className="h-12 w-12 mx-auto" aria-hidden="true" />
              ) : (
                <AlertTriangle
                  className="h-12 w-12 mx-auto"
                  aria-hidden="true"
                />
              )}
              <p className="font-semibold">
                {errorMessage ===
                "Please scan the QR code using your mobile device camera."
                  ? "Mobile Device Required"
                  : "Verification Failed"}
              </p>
              <p className="text-sm">
                {errorMessage || "An unknown error occurred."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
