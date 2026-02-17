/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectSignupForm } from "@/app/projects/[id]/ProjectForm";

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe("ProjectSignupForm saved profile reuse", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: createLocalStorageMock(),
      configurable: true,
    });
    window.localStorage.clear();
  });

  it("shows and applies saved anonymous profile info when enabled", async () => {
    window.localStorage.setItem(
      "letsassist.anonymous-signup-profile.v1",
      JSON.stringify({
        name: "Saved Volunteer",
        email: "saved@example.com",
        phone: "555-123-4567",
        updatedAt: new Date().toISOString(),
      })
    );

    render(
      <ProjectSignupForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        enableSavedInfoReuse
      />
    );

    const useSavedButton = await screen.findByRole("button", { name: "Use Saved Info" });
    expect(useSavedButton).toBeInTheDocument();

    fireEvent.click(useSavedButton);

    const fullNameInput = screen.getByLabelText("Full Name") as HTMLInputElement;
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    const phoneInput = screen.getByLabelText("Phone Number (Optional)") as HTMLInputElement;

    expect(fullNameInput.value).toBe("Saved Volunteer");
    expect(emailInput.value).toBe("saved@example.com");
    expect(phoneInput.value).toBe("555-123-4567");
  });

  it("automatically applies saved profile when auto-apply preference is set", async () => {
    window.localStorage.setItem(
      "letsassist.anonymous-signup-profile.v1",
      JSON.stringify({
        name: "Auto Profile",
        email: "auto@example.com",
        phone: "555-000-0000",
        updatedAt: new Date().toISOString(),
      })
    );
    window.localStorage.setItem("letsassist.anonymous-signup-auto-apply.v1", "true");

    render(
      <ProjectSignupForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        enableSavedInfoReuse
      />
    );

    // Should apply automatically
    const fullNameInput = await screen.findByLabelText("Full Name") as HTMLInputElement;
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;

    expect(fullNameInput.value).toBe("Auto Profile");
    expect(emailInput.value).toBe("auto@example.com");
    expect(screen.getByText("Info applied successfully")).toBeInTheDocument();
  });

  it("shows the last updated hint", async () => {
    const updatedAt = new Date(Date.now() - 5 * 60000).toISOString(); // 5 mins ago
    window.localStorage.setItem(
      "letsassist.anonymous-signup-profile.v1",
      JSON.stringify({
        name: "Old Profile",
        email: "old@example.com",
        updatedAt,
      })
    );

    render(
      <ProjectSignupForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        enableSavedInfoReuse
      />
    );

    expect(await screen.findByText("Updated 5m ago")).toBeInTheDocument();
  });

  it("persists auto-apply preference when toggled", async () => {
    window.localStorage.setItem(
      "letsassist.anonymous-signup-profile.v1",
      JSON.stringify({
        name: "Saved Volunteer",
        email: "saved@example.com",
        updatedAt: new Date().toISOString(),
      })
    );

    render(
      <ProjectSignupForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        enableSavedInfoReuse
      />
    );

    const toggle = await screen.findByLabelText("Auto-apply for future signups");
    fireEvent.click(toggle);

    expect(window.localStorage.getItem("letsassist.anonymous-signup-auto-apply.v1")).toBe("true");
  });

  it("does not show saved profile reuse UI when disabled", () => {
    window.localStorage.setItem(
      "letsassist.anonymous-signup-profile.v1",
      JSON.stringify({
        name: "Saved Volunteer",
        email: "saved@example.com",
        phone: "555-123-4567",
        updatedAt: new Date().toISOString(),
      })
    );

    render(
      <ProjectSignupForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        enableSavedInfoReuse={false}
      />
    );

    expect(screen.queryByRole("button", { name: "Use Saved Info" })).not.toBeInTheDocument();
  });
});
