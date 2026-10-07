import { z } from "zod";

type VerificationCertificate = {
  id: string;
  project_id: string | null;
  project_title: string;
  project_location: string | null;
  organization_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  is_certified: boolean | null;
  event_start: string;
  event_end: string;
  volunteer_name: string | null;
  volunteer_email: string | null;
  issued_at: string | null;
  type: string | null;
};

const durationSchema = z.union([
  z.number().finite().nonnegative(),
  z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/u)
    .transform(Number)
    .pipe(z.number().finite()),
]);

export const certificateComparisonSchema = z.object({
  expectedData: z
    .object({
      projectTitle: z.string(),
      organizerName: z.string().nullable(),
      organizationName: z.string().nullable(),
      duration: durationSchema,
      certificationStatus: z.enum(["Certified", "Participated"]),
    })
    .nullish(),
});

export function certificateVerification(certificate: VerificationCertificate) {
  const elapsed =
    Date.parse(certificate.event_end) - Date.parse(certificate.event_start);
  // Match the dashboard export's completed minutes and one-decimal hours.
  const duration =
    Number.isFinite(elapsed) && elapsed >= 0
      ? Math.round((Math.trunc(elapsed / 60_000) / 60) * 10) / 10
      : null;
  return {
    valid: true,
    exists: true,
    certificate: {
      id: certificate.id,
      certified: certificate.is_certified,
      issuedAt: certificate.issued_at,
      type: certificate.type || "platform",
      recipient: {
        name: certificate.volunteer_name,
        email: certificate.volunteer_email,
      },
    },
    event: {
      startDate: certificate.event_start,
      endDate: certificate.event_end,
      duration,
    },
    project: {
      id: certificate.project_id,
      title: certificate.project_title,
      location: certificate.project_location,
    },
    organization: { name: certificate.organization_name },
    organizer: { id: certificate.creator_id, name: certificate.creator_name },
    verification: {
      timestamp: new Date().toISOString(),
      matches: {
        certificateId: true,
        title: true,
        organizer: true,
        hours: duration !== null,
        status: certificate.is_certified,
      },
    },
  };
}
