import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MainContent } from "@/components/layout/MainContent";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { ExportSection } from "./dashboard/_components/ExportSection";
import { VolunteerDashboardView } from "./dashboard/_components/VolunteerDashboardView";
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

  test("Try again calls the retry callback Next supplies", () => {
    let retries = 0;
    const output = RootError({
      error,
      retry: () => {
        retries++;
      },
    });
    const retryButton = nodes(output).find((node) => node.type === Button);
    expect(text(retryButton)).toBe("Try again");
    expect(retryButton?.props.type).toBe("button");
    (retryButton!.props.onClick as () => void)();
    expect(retries).toBe(1);
  });
});

describe("volunteer dashboard export tab", () => {
  type Props = Parameters<typeof VolunteerDashboardView>[0];
  function exportTab(email: string | undefined) {
    const output = VolunteerDashboardView({
      statistics: {
        totalHours: 0,
        totalProjects: 0,
        recentActivity: [],
        organizations: [],
      },
      selfReportedHours: 0,
      upcomingSessions: [],
      user: { id: "fictional-user", email },
      uiCertificates: [],
    } as unknown as Props);
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
