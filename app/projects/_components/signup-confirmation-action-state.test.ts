import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runSignupConfirmationAttempt } from "./useSignupConfirmationAction";

const modal = readFileSync(
  resolve(import.meta.dir, "SignupConfirmationModal.tsx"),
  "utf8",
);
const projectDetails = readFileSync(
  resolve(import.meta.dir, "../[id]/ProjectDetails.tsx"),
  "utf8",
);
const controller = readFileSync(
  resolve(import.meta.dir, "useSignupConfirmationAction.ts"),
  "utf8",
);
const feedback = readFileSync(
  resolve(import.meta.dir, "SignupConfirmationActionFeedback.tsx"),
  "utf8",
);

describe("authenticated project signup confirmation", () => {
  test("waits for the signup result and closes only on confirmed success", () => {
    const handler = projectDetails.slice(
      projectDetails.indexOf("const handleConfirmSignup = async"),
      projectDetails.indexOf("const handleCloseModals"),
    );
    const awaitAction = handler.indexOf("await signupConfirmation.submit(");
    const signup = handler.indexOf("handleSignUp,");
    const close = handler.indexOf("setShowSignupConfirmation(false)");
    const clearSelection = handler.indexOf('setPendingScheduleId("")');

    expect(awaitAction).toBeGreaterThan(-1);
    expect(signup).toBeGreaterThan(awaitAction);
    expect(close).toBeGreaterThan(signup);
    expect(clearSelection).toBeGreaterThan(close);
    expect(controller).toContain("if (inFlight.current) return");
    expect(controller).toMatch(/if \(!result\.success\)[\s\S]*?setError/);
  });

  test("normalizes returned and thrown failures without inventing success", async () => {
    await expect(
      runSignupConfirmationAttempt(async () => ({
        success: false,
        error: "Signup is already full.",
      })),
    ).resolves.toEqual({
      success: false,
      error: "Signup is already full.",
    });
    await expect(
      runSignupConfirmationAttempt(async () => {
        throw new Error("Connection interrupted.");
      }),
    ).resolves.toEqual({
      success: false,
      error: "Connection interrupted.",
    });
  });

  test("keeps the selected schedule mounted through loading and failure", () => {
    expect(projectDetails).toContain(
      "isLoading={loadingStates[pendingScheduleId]}",
    );
    expect(projectDetails).toContain("error={signupConfirmation.error}");
    expect(projectDetails).not.toMatch(
      /setShowSignupConfirmation\(false\);\s*handleSignUp\(/,
    );
  });

  test("the modal blocks every dismissal path while pending", () => {
    expect(modal).toContain("<SignupConfirmationActionFrame");
    expect(feedback).toContain("if (!nextOpen && !isLoading) onClose()");
    expect(feedback).toContain("showCloseButton={!isLoading}");
    expect(feedback).toContain("aria-busy={isLoading}");
    expect(feedback).toContain('role="status"');
    expect(feedback).toContain("Saving your signup…");
    expect(feedback).toContain('role="alert"');
    expect(feedback).toContain("Signup not completed");
  });

  test("failure retains user input; closing or success owns reset", () => {
    expect(modal).toContain("if (!isOpen)");
    expect(modal).toContain('setComment("")');
    expect(modal).toContain("setWaiverSignature(null)");
    expect(modal).not.toMatch(/if \(error\)[\s\S]{0,200}setComment\(""\)/);
    expect(modal).toContain("disabled={isLoading}");
  });

  test("automatic status persistence uses the authorized action and exposes rejection", () => {
    const statusWriter = projectDetails.slice(
      projectDetails.indexOf("const updateProjectStatusInDB = async"),
      projectDetails.indexOf(
        "// Helper function to get attendees for a specific schedule slot",
      ),
    );

    expect(statusWriter).toContain(
      "await updateProjectStatus(project.id, newStatus)",
    );
    expect(statusWriter).toContain("toast.error");
    expect(statusWriter).toContain('label: "Refresh"');
    expect(statusWriter).not.toContain('.from("projects")');
    expect(statusWriter).not.toContain(".update({ status: newStatus })");
  });
});
