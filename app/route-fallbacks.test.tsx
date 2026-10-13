import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ErrorBoundaryHandler,
  type ErrorInfo,
} from "next/dist/client/components/error-boundary";

import { MainContent } from "@/components/layout/MainContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { ExportSection } from "./dashboard/_components/ExportSection";
import { VolunteerDashboardView } from "./dashboard/_components/VolunteerDashboardView";
import { DashboardAvatar } from "./dashboard/_components/DashboardAvatar";
import RootError from "./error";

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(value)) return [];
  return [value, ...nodes(value.props.children), ...nodes(value.props.actions)];
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (React.isValidElement<Record<string, unknown>>(value))
    return text(value.props.children);
  return "";
}

describe("root error boundary", () => {
  const error = Object.assign(new Error("fictional-record-contents"), {
    digest: "fictional-digest",
  });

  test("it shows fixed copy inside the one root main", () => {
    const html = renderToStaticMarkup(
      <MainContent>
        <RootError error={error} retry={() => {}} />
      </MainContent>,
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/id="page-content"/g)).toHaveLength(1);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("fictional-record-contents");
    expect(html).not.toContain("fictional-digest");
  });

  test("Try again uses the callback supplied by the pinned Next error boundary", () => {
    // Next's internal ErrorInfo uses `unknown` for the thrown value, while the
    // file-convention component receives the serialized Error at runtime.
    const boundary = new ErrorBoundaryHandler({
      pathname: "/fictional-error",
      errorComponent: RootError as unknown as React.ComponentType<ErrorInfo>,
      children: null,
    });
    boundary.state = {
      error: { thrownValue: error },
      previousPathname: "/fictional-error",
    };
    let refreshes = 0;
    let resets = 0;
    boundary.context = {
      refresh: () => {
        refreshes++;
      },
    } as unknown as typeof boundary.context;
    boundary.reset = () => {
      resets++;
    };

    const fallback = nodes(boundary.render()).find(
      (node) => node.type === RootError,
    );
    expect(fallback).toBeDefined();
    const supplied = fallback!.props as {
      error: Error & { digest?: string };
      retry: () => void;
      reset: () => void;
    };
    expect(typeof supplied.retry).toBe("function");
    expect(typeof supplied.reset).toBe("function");
    const output = RootError(supplied);
    const retryButton = nodes(output).find((node) => node.type === Button);
    expect(text(retryButton)).toBe("Try again");
    expect(retryButton?.props.type).toBe("button");
    (retryButton!.props.onClick as () => void)();
    expect(refreshes).toBe(1);
    expect(resets).toBe(1);
  });
});

type DashboardProps = Parameters<typeof VolunteerDashboardView>[0];
function dashboardProps(
  email: string | undefined,
  profileIdentity?: DashboardProps["profileIdentity"],
): DashboardProps {
  return {
    statistics: {
      totalHours: 0,
      totalProjects: 0,
      totalCertificates: 0,
      recentActivity: [],
      organizations: [],
      hoursByMonth: {},
    },
    selfReportedHours: 0,
    upcomingSessions: [],
    user: {
      id: "fictional-user",
      email: email ?? null,
      phone: null,
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
    },
    uiCertificates: [],
    profileIdentity,
  };
}

describe("volunteer dashboard optional profile imagery", () => {
  function header(identity?: DashboardProps["profileIdentity"]) {
    const output = VolunteerDashboardView(
      dashboardProps("volunteer@example.test", identity),
    );
    return nodes(output).find((node) => node.type === PageHeader)!;
  }

  for (const identity of [undefined, null]) {
    test(`a ${identity === null ? "null" : "missing"} identity keeps the dashboard and initials fallback`, () => {
      const output = header(identity);
      expect(output.props.title).toBe("Volunteer dashboard");
      const media = output.props.media as React.ReactElement;
      expect(media.type).toBe(DashboardAvatar);
      const html = renderToStaticMarkup(media);
      expect(html).toContain('data-slot="avatar-fallback"');
      expect(html).toContain("VO");
      expect(html).not.toContain("volunteer@example.test");
    });
  }

  test("a blank profile name uses stable initials without dropping its image", () => {
    const media = header({
      name: "   ",
      avatarUrl: "/demo/avatars/riddhiman-rana.png",
    }).props.media as React.ReactElement<{ name: string; src?: string }>;
    expect(media.props.name).toBe("Volunteer");
    expect(media.props.src).toBe("/demo/avatars/riddhiman-rana.png");
  });

  test("an available profile identity reaches the existing avatar unchanged", () => {
    const media = header({
      name: "Sample Volunteer",
      avatarUrl: "/demo/avatars/riddhiman-rana.png",
    }).props.media as React.ReactElement<{ name: string; src?: string }>;
    expect(media.props.name).toBe("Sample Volunteer");
    expect(media.props.src).toBe("/demo/avatars/riddhiman-rana.png");
  });
});

describe("volunteer dashboard export tab", () => {
  function exportTab(email: string | undefined) {
    const output = VolunteerDashboardView(dashboardProps(email));
    const tab = nodes(output).find(
      (node) => node.type === TabsContent && node.props.value === "export",
    );
    expect(tab).toBeDefined();
    return tab!;
  }

  test("an account with no email gets an explanation, not a blank tab", () => {
    const tab = exportTab(undefined);
    expect(text(tab)).toContain("Export unavailable");
    expect(text(tab)).toContain("This account has no email address.");
    expect(text(tab)).toContain("available in All hours.");
    expect(nodes(tab).some((node) => node.type === ExportSection)).toBe(false);
  });

  test("an account with an email still gets the export section", () => {
    const tab = exportTab("volunteer@example.test");
    const section = nodes(tab).find((node) => node.type === ExportSection);
    expect(section?.props.userEmail).toBe("volunteer@example.test");
    expect(text(tab)).not.toContain("Export unavailable");
  });
});
