/**
 * Render the two CSF notification email templates to `.artifacts/` for review.
 *
 * Fictional values only, and no provider, database or network is touched. The
 * output is a static preview of the markup the ledger would freeze as a
 * campaign body, not evidence that anything was sent.
 *
 *   bun run scripts/render-csf-notice-email-preview.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as React from "react";
import { render } from "@react-email/render";

import CsfPostNotification from "@/emails/csf-post-notification";
import { CsfPersonalNoticeEmail } from "@/lib/plugins/private/plugins/dvhs-csf/components/CsfPersonalNoticeEmail";
import { buildCsfNoticeCopy } from "@/lib/plugins/private/plugins/dvhs-csf/services/publication-notice-wording";

const ORIGIN = "https://development.example.test";
const ORGANIZATION = "00000000-0000-4000-8000-000000000001";
const OUTPUT = ".artifacts/csf-notice-email-preview";

async function main() {
  await mkdir(OUTPUT, { recursive: true });

  const submission = buildCsfNoticeCopy({
    sourceKind: "point_submission",
    chapterName: "DVHS CSF",
    subject: "Community garden build",
    termLabel: "Fall 2026",
    outcome: "approved",
  });
  const profile = buildCsfNoticeCopy({
    sourceKind: "profile",
    chapterName: "DVHS CSF",
    subject: null,
    termLabel: "Fall 2026",
  });

  const files: Array<[string, string]> = [
    [
      "point-submission-approved.html",
      await render(
        React.createElement(CsfPersonalNoticeEmail, {
          chapterName: "DVHS CSF",
          context: submission.context,
          headline: submission.title,
          message: submission.body,
          actionLabel: "View submission",
          actionUrl: `${ORIGIN}/organization/${ORGANIZATION}?tab=csf-submissions&csf_submission=${ORGANIZATION}`,
          settingsUrl: `${ORIGIN}/account/notifications`,
        }),
      ),
    ],
    [
      "profile-updated.html",
      await render(
        React.createElement(CsfPersonalNoticeEmail, {
          chapterName: "DVHS CSF",
          context: profile.context,
          headline: profile.title,
          message: profile.body,
          actionLabel: "View profile",
          actionUrl: `${ORIGIN}/organization/${ORGANIZATION}?tab=csf-profile`,
          settingsUrl: `${ORIGIN}/account/notifications`,
        }),
      ),
    ],
    [
      "post-announcement.html",
      await render(
        React.createElement(CsfPostNotification, {
          chapterName: "DVHS CSF",
          audienceLabel: "Class of 2028",
          termLabel: "Fall 2026",
          postTitle: "Community garden build this Saturday",
          postParagraphs: [
            "We have twelve spots open for the garden build at the community center.",
            "Bring gloves. Sign up in Let's Assist to claim a spot.",
          ],
          postUrl: `${ORIGIN}/organization/${ORGANIZATION}/plugins/dvhs-csf/home`,
          unsubscribeUrl: `${ORIGIN}/unsubscribe/csf/${ORGANIZATION}/announcements`,
          publishedAtLabel: "September 16, 2026",
        }),
      ),
    ],
  ];

  for (const [name, html] of files) {
    await writeFile(`${OUTPUT}/${name}`, html, "utf8");
    console.log(`wrote ${OUTPUT}/${name}`);
  }
}

await main();
