import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

import { CertificateCardButton } from "./CertificateCardButton";
import {
  TimezoneDateDisplay,
  TimezoneEventDateRange,
} from "./TimezoneDateDisplay";

export interface CertificateDocumentData {
  id: string;
  project_title: string;
  creator_name: string | null;
  creator_username: string | null;
  is_certified: boolean;
  event_start: string;
  event_end: string;
  check_in_method: string;
  organization_name: string | null;
  project_id: string | null;
  issued_at: string;
  volunteer_name: string | null;
  project_location: string | null;
  description: string | null;
}

function checkInMethodLabel(method: string | null | undefined): string {
  if (!method) return "Manual";
  const normalized = method.toLowerCase();
  if (normalized === "qr-code") return "QR code";
  if (normalized === "auto") return "Automatic check-in";
  if (normalized === "signup only" || normalized === "signup-only") {
    return "Signup only";
  }
  return method;
}

function Detail({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-0.5 font-medium wrap-break-word">{children}</dd>
    </div>
  );
}

/**
 * The certificate as a flat document: who volunteered, for what and for how
 * long, then the details someone checking it would look for.
 */
export function CertificateDocument({
  data,
  durationText,
  isSelfReported,
}: {
  data: CertificateDocumentData;
  durationText: string;
  isSelfReported: boolean;
}) {
  const issuerLabel = isSelfReported ? "Supervised by" : "Issued by";

  return (
    <article className="bg-card rounded-xl border text-sm">
      <div className="grid gap-6 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="Let's Assist Logo"
              width={20}
              height={20}
            />
            <span className="font-semibold">Let&apos;s Assist</span>
          </div>
          {data.is_certified ? (
            <Badge variant="success" aria-label="Verified badge">
              Verified
            </Badge>
          ) : isSelfReported ? (
            <Badge variant="outline">Self-reported</Badge>
          ) : null}
        </div>

        <div className="grid gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-balance wrap-break-word">
            {data.project_title}
          </h2>
          {data.organization_name ? (
            <p className="text-muted-foreground">{data.organization_name}</p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-6 border-y py-6">
          <div>
            <dt className="text-muted-foreground text-sm">Volunteer</dt>
            <dd className="mt-0.5 text-lg font-semibold wrap-break-word">
              {data.volunteer_name || "Unnamed Volunteer"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Duration</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">
              {durationText}
            </dd>
          </div>
        </dl>

        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-sm">Date</dt>
            <dd className="mt-0.5">
              <TimezoneEventDateRange
                startDate={data.event_start}
                endDate={data.event_end}
              />
            </dd>
          </div>
          {data.project_location ? (
            <Detail label="Location">{data.project_location}</Detail>
          ) : null}
          {data.creator_name ? (
            <Detail label={issuerLabel}>
              {!isSelfReported && data.creator_username ? (
                <Link
                  href={`/profile/${data.creator_username}`}
                  className="underline-offset-4 hover:underline"
                  aria-label={`View profile of ${data.creator_name}`}
                >
                  {data.creator_name}
                </Link>
              ) : (
                data.creator_name
              )}
            </Detail>
          ) : null}
          {isSelfReported && data.description ? (
            <Detail label="Description" className="sm:col-span-2">
              <span className="leading-relaxed font-normal">
                {data.description}
              </span>
            </Detail>
          ) : null}
        </dl>
      </div>

      <section className="grid gap-4 border-t p-6 sm:p-8">
        <div className="grid gap-1">
          <h2 className="text-base font-medium">
            {isSelfReported ? "Record details" : "Verification details"}
          </h2>
          <p className="text-muted-foreground">
            {isSelfReported
              ? "This is a self-reported record of volunteer hours logged by the user."
              : "This is an official record of volunteer hours from Let's Assist."}
            {data.is_certified
              ? " Verified badges mean this certificate comes from a verified organization."
              : null}
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <Detail
            label={`${isSelfReported ? "Record" : "Verification"} ID`}
            className="sm:col-span-2"
          >
            <span className="font-mono break-all">{data.id}</span>
          </Detail>
          <Detail label="Record created">
            <TimezoneDateDisplay
              dateString={data.issued_at}
              format="MMM d, yyyy"
              fallbackText="Loading..."
            />
          </Detail>
          {!isSelfReported ? (
            <Detail label="Check-in method">
              {checkInMethodLabel(data.check_in_method)}
            </Detail>
          ) : null}
        </dl>
        {!isSelfReported && data.project_id ? (
          <div>
            <CertificateCardButton projectId={data.project_id} />
          </div>
        ) : null}
      </section>
    </article>
  );
}
