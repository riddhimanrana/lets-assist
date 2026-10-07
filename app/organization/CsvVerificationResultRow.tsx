import { CheckCircle, ChevronRight, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import {
  CertificateStatusBadge,
  CertificateTypeBadge,
} from "./CsvVerificationBadges";
import { formatHours } from "./csv-verification-logic";
import type { CertificateRow } from "./csv-verification-types";

const MATCH_LABELS: Record<string, string> = {
  certificateId: "Certificate ID",
  title: "Project title",
  organizer: "Organizer name",
  hours: "Duration/hours",
  status: "Certification status",
  type: "Certificate type",
};

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/** One record: a scannable summary line that opens to show what was checked. */
export function CsvVerificationResultRow({ row }: { row: CertificateRow }) {
  const matches = row.verificationResult?.valid
    ? row.verificationResult.verification?.matches
    : undefined;
  const canView = Boolean(row.certificateId && row.isVerified);
  const certificateHref = `/certificates/${row.certificateId}`;

  return (
    <Collapsible render={<li />}>
      <div className="flex items-center sm:pr-2">
        <CollapsibleTrigger className="group/row hover:bg-muted/50 focus-visible:ring-ring/50 flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset">
          <ChevronRight
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]/row:rotate-90 motion-reduce:transition-none"
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-sm font-medium">
              {row.projectTitle || "Untitled project"}
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {row.organizationName || "N/A"}
              {row.duration ? `, ${formatHours(parseFloat(row.duration))}` : ""}
            </span>
          </span>
          <span className="hidden shrink-0 sm:block">
            <CertificateTypeBadge row={row} />
          </span>
          <span className="shrink-0">
            <CertificateStatusBadge row={row} />
          </span>
        </CollapsibleTrigger>
        <span className="hidden w-14 shrink-0 justify-end sm:flex">
          {canView ? (
            <a
              href={certificateHref}
              target="_blank"
              rel="noreferrer"
              aria-label={`View certificate for ${row.projectTitle || "this record"}`}
              className={buttonVariants({ variant: "ghost" })}
            >
              View
            </a>
          ) : null}
        </span>
      </div>

      <CollapsibleContent>
        <div className="bg-muted/30 grid gap-4 border-t px-4 py-4 sm:pl-11">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Detail label="Certificate ID">
              <span className="font-mono text-xs break-all">
                {row.certificateId || "-"}
              </span>
            </Detail>
            <Detail label="Organization">
              {row.organizationName || "N/A"}
            </Detail>
            <Detail label="Organizer">{row.organizerName || "-"}</Detail>
            {row.certificationStatus ? (
              <Detail label="Status">{row.certificationStatus}</Detail>
            ) : null}
            <Detail label="Type">
              <CertificateTypeBadge row={row} />
            </Detail>
            {row.duration ? (
              <Detail label="Duration">
                {formatHours(parseFloat(row.duration))}
              </Detail>
            ) : null}
          </dl>

          {row.issues.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Format issues</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {row.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {matches ? (
            <div className="grid gap-3">
              <h4 className="text-sm font-medium">
                Field verification results
              </h4>
              <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {Object.entries(matches).map(([key, value]) => (
                  <li key={key} className="flex items-center gap-2">
                    {value ? (
                      <CheckCircle
                        aria-hidden="true"
                        className="text-success size-4 shrink-0"
                      />
                    ) : (
                      <XCircle
                        aria-hidden="true"
                        className="text-warning size-4 shrink-0"
                      />
                    )}
                    <span>
                      {MATCH_LABELS[key] ??
                        key.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <span className="sr-only">
                      {value ? "matches" : "does not match"}
                    </span>
                  </li>
                ))}
              </ul>
              {row.isVerified ? (
                <Alert variant="success">
                  <AlertDescription>
                    Perfect match: all data verified successfully
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <AlertDescription>
                    Data mismatch: some fields don&apos;t match our database
                    records
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : null}

          {canView ? (
            <a
              href={certificateHref}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({
                variant: "outline",
                className: "w-full sm:hidden",
              })}
            >
              View certificate
            </a>
          ) : null}

          {row.verificationStatus === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>Certificate not found in our database</AlertTitle>
              {row.verificationResult?.error ? (
                <AlertDescription>
                  Error: {row.verificationResult.error}
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
