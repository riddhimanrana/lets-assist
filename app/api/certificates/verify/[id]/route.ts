import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const param = await params;
    const certificateId = param.id;
    
    if (!certificateId) {
      return NextResponse.json(
        { error: "Certificate ID is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: certificate, error: certError } = await supabase
      .from('certificates')
      .select(`
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
        volunteer_name,
        volunteer_email,
        issued_at,
        type
      `)
      .eq('id', certificateId)
      .single();

    if (certError || !certificate) {
      return NextResponse.json(
        { 
          error: "Certificate not found",
          valid: false,
          exists: false
        },
        { status: 404 }
      );
    }

    const verificationResult = {
      valid: true,
      exists: true,
      certificate: {
        id: certificate.id,
        certified: certificate.is_certified,
        issuedAt: certificate.issued_at,
        type: certificate.type || 'platform', // Default to 'platform' for backward compatibility
        recipient: {
          name: certificate.volunteer_name,
          email: certificate.volunteer_email
        }
      },
      event: {
        startDate: certificate.event_start,
        endDate: certificate.event_end
      },
      project: {
        id: certificate.project_id,
        title: certificate.project_title,
        location: certificate.project_location
      },
      organization: {
        name: certificate.organization_name
      },
      organizer: {
        id: certificate.creator_id,
        name: certificate.creator_name
      },
      verification: {
        timestamp: new Date().toISOString(),
        matches: {
          certificateId: true,
          title: true,
          organizer: true,
          hours: true,
          status: certificate.is_certified
        }
      }
    };

    return NextResponse.json(verificationResult);

  } catch (error) {
    console.error('Certificate verification error:', error);
    return NextResponse.json(
      { 
        error: "Internal server error during verification",
        valid: false,
        exists: false
      },
      { status: 500 }
    );
  }
}

// Optional: Add POST method for batch verification
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { expectedData } = body;
    
    // Get the certificate verification from GET method
    const verificationResult = await GET(request, { params });
    const verification = await verificationResult.json();

    if (!verification.valid) {
      return NextResponse.json(verification);
    }

    // Compare with expected data if provided
    if (expectedData) {
      const matches = {
        certificateId: true,
        title: verification.project.title === expectedData.projectTitle,
        organizer: verification.organizer.name === expectedData.organizerName,
        organization: verification.organization.name === expectedData.organizationName,
        hours: verification.event.duration === parseFloat(expectedData.duration || '0'),
        status: verification.certificate.certified === (expectedData.certificationStatus === 'Certified')
      };

      verification.verification.matches = matches;
    }

    return NextResponse.json(verification);

  } catch (error) {
    console.error('Certificate batch verification error:', error);
    return NextResponse.json(
      { 
        error: "Internal server error during batch verification",
        valid: false,
        exists: false
      },
      { status: 500 }
    );
  }
}
