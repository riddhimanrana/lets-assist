import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

import type { CertificateRow } from "./csv-verification-types";

/** What the file says a row is, or what our records say once it is verified. */
export function certificateTypeLabel(row: CertificateRow) {
  if (!row.isVerified || !row.verificationResult?.certificate) {
    // Default based on CSV type
    const csvType = row.certificateType || "platform";
    return csvType === "self-reported" ? "Self-reported" : "Platform";
  }

  const cert = row.verificationResult.certificate;
  const certType = cert.type || "platform";

  if (cert.certified && (certType === "platform" || certType === "verified")) {
    // Official: verified org
    return "Official";
  }
  if (certType === "platform" || certType === "verified") {
    // Platform: Let's Assist project
    return "Platform";
  }
  return "Self-reported";
}

/** A label, so it is glossy: the one that matters most is the filled one. */
export function CertificateTypeBadge({ row }: { row: CertificateRow }) {
  const label = certificateTypeLabel(row);
  return (
    <Badge
      variant={
        label === "Official"
          ? "default"
          : label === "Platform"
            ? "secondary"
            : "outline"
      }
    >
      {label}
    </Badge>
  );
}

/** One flat status per row. Format problems win over lookup results. */
export function CertificateStatusBadge({ row }: { row: CertificateRow }) {
  if (!row.valid) return <Badge variant="destructive">Invalid format</Badge>;
  if (!row.verificationStatus) {
    return <Badge variant="secondary">Valid format</Badge>;
  }
  if (row.verificationStatus === "pending") {
    return (
      <Badge variant="outline">
        <Loader2 aria-hidden="true" className="animate-spin" />
        Checking
      </Badge>
    );
  }
  if (row.isVerified) return <Badge variant="success">Verified</Badge>;
  if (row.verificationStatus === "verified") {
    return <Badge variant="warning">Data mismatch</Badge>;
  }
  return <Badge variant="destructive">Not found</Badge>;
}
