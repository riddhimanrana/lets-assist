import { safeConsole } from "@/lib/safe-console";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  certificateComparisonSchema,
  certificateVerification,
} from "@/lib/certificates/verification";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const param = await params;
    const certificateId = param.id;

    if (!certificateId) {
      return NextResponse.json(
        { error: "Certificate ID is required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    const { data: certificate, error: certError } = await supabase
      .from("certificates")
      .select(
        `
        id,
        project_id,
        project_title,
        project_location,
        organization_name,
        creator_id,
        creator_name,
        is_certified,
        event_start,
        event_end,
        credited_minutes,
        volunteer_name,
        volunteer_email,
        issued_at,
        type
      `,
      )
      .eq("id", certificateId)
      .single();

    if (certError || !certificate) {
      return NextResponse.json(
        {
          error: "Certificate not found",
          valid: false,
          exists: false,
        },
        { status: 404 },
      );
    }

    const verificationResult = certificateVerification(certificate);

    return NextResponse.json(verificationResult);
  } catch (error) {
    safeConsole.error("Certificate verification error:", error);
    return NextResponse.json(
      {
        error: "Internal server error during verification",
        valid: false,
        exists: false,
      },
      { status: 500 },
    );
  }
}

// Compare one readable certificate with supplied export data.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = certificateComparisonSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid certificate comparison data", valid: false },
        { status: 400 },
      );
    }
    const { expectedData } = parsed.data;

    // Get the certificate verification from GET method
    const verificationResult = await GET(request, { params });
    if (!verificationResult.ok) return verificationResult;
    const verification = (await verificationResult.json()) as ReturnType<
      typeof certificateVerification
    >;

    // Compare with expected data if provided
    if (expectedData) {
      const matches = {
        certificateId: true,
        title: verification.project.title === expectedData.projectTitle,
        organizer: verification.organizer.name === expectedData.organizerName,
        organization:
          verification.organization.name === expectedData.organizationName,
        hours:
          verification.event.duration !== null &&
          Math.abs(verification.event.duration - expectedData.duration) <
            0.000001,
        status:
          verification.certificate.certified ===
          (expectedData.certificationStatus === "Certified"),
      };

      verification.verification.matches = matches;
    }

    return NextResponse.json(verification);
  } catch (error) {
    safeConsole.error("Certificate batch verification error:", error);
    return NextResponse.json(
      {
        error: "Internal server error during batch verification",
        valid: false,
        exists: false,
      },
      { status: 500 },
    );
  }
}
