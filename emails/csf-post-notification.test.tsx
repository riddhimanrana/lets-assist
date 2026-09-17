import { describe, expect, test } from "bun:test";
import { render } from "@react-email/render";
import * as React from "react";
import CsfPostNotification from "./csf-post-notification";

describe("CSF publication email", () => {
  for (const kind of ["post", "activity"] as const) {
    test(`renders ${kind} context, content and notification controls`, async () => {
      const html = await render(
        <CsfPostNotification
          chapterName="Example CSF"
          audienceLabel="Class of 2028"
          termLabel="Fall 2026"
          kind={kind}
          postTitle="Park cleanup"
          postParagraphs={[
            "Meet at the entrance.\n• Bring gloves\n• Bring water",
            "<script>alert(1)</script>",
          ]}
          postUrl="https://lets-assist.com/organization/example?tab=csf-activities"
          unsubscribeUrl="https://lets-assist.com/unsubscribe/csf/example/announcements"
          settingsUrl="https://lets-assist.com/account/notifications"
          publishedAtLabel="September 16, 2026"
        />,
      );
      expect(html.replace(/<!--.*?-->/g, "")).toInclude(`posted a new ${kind}`);
      expect(html).toInclude("Class of 2028");
      expect(html).toInclude("Fall 2026");
      expect(html).toInclude(kind === "post" ? "View post" : "View activity");
      expect(html).toInclude("Notification settings");
      expect(html).toInclude("https://lets-assist.com/account/notifications");
      expect(html).toInclude("Unsubscribe from announcement emails");
      expect(html).toInclude("Bring gloves");
      expect(html).not.toInclude("<script>");
    });
  }
});
