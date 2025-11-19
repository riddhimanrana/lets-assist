import React from "react";
import { render } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn().mockResolvedValue(undefined) }),
  usePathname: () => "/home",
}));

// Mock DOM helpers used by the component
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: any) => <div>{children}</div>, CardHeader: ({ children }: any) => <div>{children}</div>, CardContent: ({ children }: any) => <div>{children}</div>, CardTitle: ({ children }: any) => <div>{children}</div>, CardDescription: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/progress", () => ({ Progress: ({ value, className }: any) => <div className={className}>{value}</div> }));
vi.mock("@/lib/utils", () => ({ cn: (...parts: any[]) => parts.filter(Boolean).join(" ") }));
vi.mock("@/components/onboarding/first-login-tour-steps", () => ({
  FIRST_LOGIN_TOUR_STEPS: [
    {
      icon: () => null,
      title: "Welcome",
      description: "desc",
      highlight: "hl",
      selector: "[data-tour-id='home-greeting']",
    },
  ],
}));

import FirstLoginTour from "../FirstLoginTour";

describe("FirstLoginTour", () => {
  it("renders without throwing", () => {
    const onComplete = vi.fn();
    const onSkip = vi.fn();

    expect(() =>
      render(<FirstLoginTour isOpen={true} onComplete={onComplete} onSkip={onSkip} />)
    ).not.toThrow();
  });
});
