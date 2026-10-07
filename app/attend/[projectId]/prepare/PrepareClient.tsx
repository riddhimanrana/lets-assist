"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { redeemAttendanceChallenge } from "./actions";
import { AlertTriangle, Smartphone } from "lucide-react";
import { NoticePage } from "@/components/projects/NoticePage";
import { Spinner } from "@/components/ui/spinner";

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

  const isDeviceError =
    status === "error" &&
    errorMessage === "Please scan the QR code using your mobile device camera.";

  if (status === "error") {
    return (
      <NoticePage
        icon={
          isDeviceError ? (
            <Smartphone aria-hidden="true" />
          ) : (
            <AlertTriangle aria-hidden="true" />
          )
        }
        tone="destructive"
        title={isDeviceError ? "Mobile device required" : "Verification failed"}
        description={
          isDeviceError
            ? "This check-in process must be completed on a mobile device."
            : undefined
        }
      >
        <p className="text-sm" role="alert">
          {errorMessage || "An unknown error occurred."}
        </p>
      </NoticePage>
    );
  }

  return (
    <NoticePage
      icon={
        <Spinner
          aria-label={status === "success" ? "Redirecting" : "Loading"}
        />
      }
      title="Verifying attendance link"
      description="Please wait while we prepare your check-in..."
    >
      <p className="text-muted-foreground text-sm" role="status">
        {status === "success" ? "Redirecting..." : "Verifying..."}
      </p>
    </NoticePage>
  );
}
