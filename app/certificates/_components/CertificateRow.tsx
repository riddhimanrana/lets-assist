"use client";

import { format, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import {
  calculateDecimalHours,
  formatTotalDuration,
  type CertificateWithHours,
} from "./certificate-hours";

/**
 * One line of the hours record. The title link covers the whole row; the
 * delete control for self-reported hours sits above it.
 */
export function CertificateRow({
  cert,
  reserveActionSlot,
  isDeleting,
  onDelete,
}: {
  cert: CertificateWithHours;
  reserveActionSlot: boolean;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const isSelfReported = cert.type === "self-reported";
  const meta = [
    cert.organization_name,
    format(parseISO(cert.issued_at), "MMM d, yyyy"),
    cert.project_location,
  ].filter(Boolean);

  return (
    <li className="hover:bg-muted has-[a:focus-visible]:bg-muted relative flex items-center gap-3 px-4 py-3 transition-colors">
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/certificates/${cert.id}`}
            className="min-w-0 font-medium wrap-break-word underline-offset-4 outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            {cert.project_title}
          </Link>
          {cert.is_certified ? (
            <Badge variant="success">Certified</Badge>
          ) : null}
          {isSelfReported ? (
            <Badge variant="outline">Self-reported</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {meta.join(" · ")}
        </p>
      </div>
      <span className="shrink-0 text-right font-medium tabular-nums">
        {formatTotalDuration(
          calculateDecimalHours(cert.event_start, cert.event_end),
        )}
      </span>
      {isSelfReported ? (
        <Button
          variant="destructive-ghost"
          size="icon"
          className="relative"
          onClick={onDelete}
          disabled={isDeleting}
          title="Delete self-reported hours"
          aria-label={`Delete self-reported hours for ${cert.project_title}`}
        >
          {isDeleting ? (
            <Spinner aria-hidden="true" />
          ) : (
            <Trash2 aria-hidden="true" />
          )}
        </Button>
      ) : reserveActionSlot ? (
        <span className="size-9 shrink-0" aria-hidden="true" />
      ) : null}
    </li>
  );
}
