import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { render } from "react-email";
import CertificatePublished from "./certificate-published";

const common = {
  volunteerName: "Volunteer Example",
  projectTitle: "Community cleanup",
  certificateId: "certificate-example",
  certificateUrl: "https://example.test/certificate",
  isAutoPublished: false,
  eventStart: "2026-09-19T16:00:00Z",
  eventEnd: "2026-09-19T22:00:00Z",
  timezone: "America/Los_Angeles",
};

test("certificate email states credited split-shift time instead of the six-hour envelope", async () => {
  const html = await render(
    <CertificatePublished {...common} creditedMinutes={125} />,
  );
  assert.match(html, /Hours credited/);
  assert.match(html.replace(/<!--[\s\S]*?-->/g, ""), /2h 5m, excluding breaks/);
  assert.doesNotMatch(html, /6h 0m/);
});

test("historical emails retain their existing date and time presentation without a fabricated total", async () => {
  const html = await render(
    <CertificatePublished {...common} creditedMinutes={null} />,
  );
  assert.doesNotMatch(html, /Hours credited/);
  assert.match(html, /September 19, 2026/);
});

test("automatic publication emails display the same canonical duration", async () => {
  const html = await render(
    <CertificatePublished {...common} isAutoPublished creditedMinutes={61} />,
  );
  assert.match(html.replace(/<!--[\s\S]*?-->/g, ""), /1h 1m, excluding breaks/);
});

test("both delivery paths forward canonical totals while prepared durable payloads remain immutable", () => {
  const durable = readFileSync(
    new URL(
      "../lib/projects/hours-publication-email-service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const supplemental = readFileSync(
    new URL(
      "../app/projects/[id]/hours/certificate-issuance.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(durable, /creditedMinutes: certificate\.credited_minutes/);
  assert.match(durable, /creditedMinutes: delivery\.creditedMinutes/);
  assert.match(
    durable,
    /if \(!delivery\.payloadPrepared\) \{[\s\S]*?html = await render/,
  );
  assert.match(supplemental, /creditedMinutes: cert\.credited_minutes/);
  assert.match(supplemental, /credited_minutes: cert\.credited_minutes/);
});
