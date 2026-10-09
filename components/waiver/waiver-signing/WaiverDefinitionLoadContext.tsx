"use client";

import { createContext, useContext } from "react";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Whether the project's real waiver definition is available to the signing
 * dialog. Without it the dialog would fall back to a single generic signer and
 * collect a signature the project's definition cannot be checked against, so
 * the dialog refuses to start until the status is "ready".
 *
 * A dialog rendered outside a provider is "ready": its caller already passed
 * the definition it means to use.
 */
export type WaiverDefinitionLoadState = {
  status: "loading" | "ready" | "error";
  retry: () => void;
};

const READY: WaiverDefinitionLoadState = { status: "ready", retry: () => {} };

const WaiverDefinitionLoadContext =
  createContext<WaiverDefinitionLoadState>(READY);

export const WaiverDefinitionLoadProvider =
  WaiverDefinitionLoadContext.Provider;

export function useWaiverDefinitionLoad(): WaiverDefinitionLoadState {
  return useContext(WaiverDefinitionLoadContext);
}

/** What the signing dialog shows in place of its steps until the form loads. */
export function WaiverDefinitionPending({
  state,
}: {
  state: WaiverDefinitionLoadState;
}) {
  if (state.status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>The waiver form did not load</AlertTitle>
          <AlertDescription>
            You cannot sign until it loads. Check your connection and try again.
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-fit"
            onClick={state.retry}
          >
            Try again
          </Button>
        </Alert>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="text-muted-foreground flex h-full items-center justify-center gap-3 p-6 text-sm"
    >
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      Loading the waiver form
    </div>
  );
}
