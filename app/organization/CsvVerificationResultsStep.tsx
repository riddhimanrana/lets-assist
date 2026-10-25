import { StatStrip } from "@/components/layout/SettingsSection";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";

import { CsvVerificationResultRow } from "./CsvVerificationResultRow";
import { formatHours } from "./csv-verification-logic";
import type {
  CertificateRow,
  CsvVerificationSummary,
} from "./csv-verification-types";

/** Step 2: a progress bar while each certificate is looked up. */
export function CsvVerificationProgress({ progress }: { progress: number }) {
  return (
    <Progress value={progress}>
      <ProgressLabel>Verifying certificates</ProgressLabel>
      <ProgressValue />
    </Progress>
  );
}

/** Step 3: the headline numbers, what the three hour types mean, and each record. */
export function CsvVerificationSummaryBlock({
  summary,
}: {
  summary: CsvVerificationSummary;
}) {
  return (
    <section aria-labelledby="csv-summary-title" className="grid gap-3">
      <h3 id="csv-summary-title" className="text-sm font-medium">
        Certificate summary
      </h3>
      <StatStrip
        items={[
          {
            label: "Total hours",
            value: formatHours(summary.totalHours),
          },
          { label: "Official", value: formatHours(summary.certifiedHours) },
          { label: "Platform", value: formatHours(summary.verifiedHours) },
          {
            label: "Self-reported",
            value: formatHours(summary.selfReportedHours),
          },
          { label: "Total records", value: summary.total },
          { label: "Invalid/not found", value: summary.invalidFormat },
        ]}
      />
      <dl className="text-muted-foreground grid gap-1 text-sm">
        <div>
          <dt className="text-foreground inline font-medium">Official: </dt>
          <dd className="inline">
            Hours from verified organizations that have been audited by
            Let&apos;s Assist
          </dd>
        </div>
        <div>
          <dt className="text-foreground inline font-medium">Platform: </dt>
          <dd className="inline">
            Hours from projects that were hosted directly on the Let&apos;s
            Assist platform
          </dd>
        </div>
        <div>
          <dt className="text-foreground inline font-medium">
            Self-reported:{" "}
          </dt>
          <dd className="inline">
            Self-reported volunteer hours from outside Let&apos;s Assist
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function CsvVerificationRecordList({
  results,
}: {
  results: CertificateRow[];
}) {
  return (
    <section aria-labelledby="csv-records-title" className="grid gap-3">
      <h3 id="csv-records-title" className="text-sm font-medium">
        Record details ({results.length} record
        {results.length === 1 ? "" : "s"})
      </h3>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {results.map((row, index) => (
          <CsvVerificationResultRow key={index} row={row} />
        ))}
      </ul>
    </section>
  );
}
