"use client";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const wait = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

export function SonnerHarnessClient() {
  const showDefaultToast = () => {
    toast("Normal/default toast", {
      description: "This is the standard Sonner toast style.",
    });
  };

  const showInfoToast = () => {
    toast.info("Info toast", {
      description: "Useful for neutral status updates.",
    });
  };

  const showSuccessToast = () => {
    toast.success("Success toast", {
      description: "Great success. Everything worked.",
    });
  };

  const showWarningToast = () => {
    toast.warning("Warning toast", {
      description: "Heads up! Something needs attention.",
    });
  };

  const showErrorToast = () => {
    toast.error("Error toast", {
      description: "Something failed. Please try again.",
    });
  };

  const showLoadingToast = () => {
    const loadingId = toast.loading("Loading toast", {
      description: "This will auto-update to success in 2 seconds.",
    });

    window.setTimeout(() => {
      toast.success("Loading complete", {
        id: loadingId,
        description: "The same toast was updated by id.",
      });
    }, 2000);
  };

  const showToastWithActionAndCancel = () => {
    toast("Toast with action + cancel", {
      description: "Click action or cancel in the toast itself.",
      action: {
        label: "Undo",
        onClick: () => toast.info("Undo clicked"),
      },
      cancel: {
        label: "Dismiss",
        onClick: () => toast("Cancel clicked"),
      },
      duration: 10000,
    });
  };

  const showPersistentToast = () => {
    toast("Persistent toast (duration: Infinity)", {
      description: "This one stays until dismissed.",
      duration: Number.POSITIVE_INFINITY,
      id: "persistent-sonner-demo",
    });
  };

  const showStyledLifecycleToast = () => {
    toast("Styled toast + lifecycle callbacks", {
      description: "Uses close button, className/style, onDismiss, and onAutoClose.",
      closeButton: true,
      className: "border-info/60",
      style: {
        borderWidth: "1px",
      },
      onDismiss: () => {
        toast.info("Dismiss callback fired");
      },
      onAutoClose: () => {
        toast.info("Auto-close callback fired");
      },
      duration: 7000,
    });
  };

  const runPromiseSuccessToast = () => {
    const successPromise = wait(1600).then(() => "Saved");

    toast.promise(successPromise, {
      loading: "Saving changes...",
      success: "Saved successfully!",
      error: "Save failed.",
      description: "Promise success flow",
    });
  };

  const runPromiseFailureToast = () => {
    const failurePromise = wait(1600).then(() => {
      throw new Error("Request failed");
    });

    toast.promise(failurePromise, {
      loading: "Submitting request...",
      success: "Request finished",
      error: (error) => `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      description: "Promise failure flow",
    });
  };

  const runStepByStepUpdateToast = () => {
    const id = "step-by-step-sonner-demo";

    toast("Step 1/3", {
      id,
      description: "Preparing request...",
    });

    window.setTimeout(() => {
      toast("Step 2/3", {
        id,
        description: "Uploading data...",
      });
    }, 1000);

    window.setTimeout(() => {
      toast.success("Step 3/3 complete", {
        id,
        description: "All steps finished.",
      });
    }, 2000);
  };

  const showCustomContentToast = () => {
    toast.custom((id) => (
      <div className="bg-card text-card-foreground border rounded-lg px-4 py-3 shadow-sm w-full">
        <p className="font-medium">Custom JSX toast</p>
        <p className="text-sm text-muted-foreground mt-1">You can render arbitrary React content.</p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => toast.dismiss(id)}
        >
          Close custom toast
        </Button>
      </div>
    ));
  };

  const showMultipleToasts = () => {
    toast.success("Batch #1");
    toast.info("Batch #2");
    toast.warning("Batch #3");
    toast.error("Batch #4");
  };

  const dismissAllToasts = () => {
    toast.dismiss();
  };

  return (
    <div className="container mx-auto max-w-4xl py-12 px-4" data-testid="sonner-test-harness">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold mb-2">Sonner Test Harness</h1>
        <p className="text-muted-foreground">
          Click buttons to preview Sonner toast types, variants, and common option patterns.
        </p>
      </div>

      <div className="border rounded-lg p-6 space-y-8">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Core toast types</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Button onClick={showDefaultToast} data-testid="toast-default">Normal / Default</Button>
            <Button onClick={showInfoToast} variant="secondary" data-testid="toast-info">Info</Button>
            <Button onClick={showSuccessToast} variant="secondary" data-testid="toast-success">Success</Button>
            <Button onClick={showWarningToast} variant="secondary" data-testid="toast-warning">Warning</Button>
            <Button onClick={showErrorToast} variant="destructive" data-testid="toast-error">Error</Button>
            <Button onClick={showLoadingToast} variant="outline" data-testid="toast-loading">Loading → Success</Button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Options and interactions</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Button onClick={showToastWithActionAndCancel} variant="outline" data-testid="toast-action-cancel">
              Action + Cancel
            </Button>
            <Button onClick={showPersistentToast} variant="outline" data-testid="toast-persistent">
              Persistent (No Auto Close)
            </Button>
            <Button onClick={showStyledLifecycleToast} variant="outline" data-testid="toast-styled-callbacks">
              Styled + Callbacks
            </Button>
            <Button onClick={runPromiseSuccessToast} variant="outline" data-testid="toast-promise-success">
              Promise Success
            </Button>
            <Button onClick={runPromiseFailureToast} variant="outline" data-testid="toast-promise-failure">
              Promise Failure
            </Button>
            <Button onClick={runStepByStepUpdateToast} variant="outline" data-testid="toast-update-by-id">
              Update By ID
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Advanced</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={showCustomContentToast} variant="secondary" data-testid="toast-custom">
              Custom JSX Toast
            </Button>
            <Button onClick={showMultipleToasts} variant="secondary" data-testid="toast-batch">
              Show Multiple Toasts
            </Button>
          </div>
        </section>

        <section className="pt-2 border-t">
          <Button onClick={dismissAllToasts} variant="destructive" data-testid="toast-dismiss-all">
            Dismiss All Toasts
          </Button>
        </section>
      </div>

      <div className="mt-6 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info">
        Available only in non-production environments.
      </div>
    </div>
  );
}