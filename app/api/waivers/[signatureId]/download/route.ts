import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { getAdminClient } from '@/lib/supabase/admin';
import { generateSignedWaiverPdf, requiresPdfGeneration } from '@/lib/waiver/generate-signed-waiver-pdf';
import { checkWaiverAccess, getContentDisposition } from '@/lib/waiver/preview-auth-helpers';
import type { SignaturePayload } from '@/types/waiver-definitions';

interface WaiverSignatureRecord {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  waiver_pdf_url: string | null;
  signature_payload: SignaturePayload | null;
  signature_file_url?: string | null; // DEPRECATED - column may not exist in schema
  signature_storage_path: string | null;
  signed_at: string | null;
  upload_storage_path: string | null;
  signature_text: string | null;
  waiver_definition_id: string | null;
  project_id: string;
  signup_id?: string | null;
  waiver_definition?: {
    id: string;
    pdf_public_url: string | null;
    signers: Array<{
      id: string;
      role_key: string;
      label: string;
      required: boolean;
      order_index: number;
    }>;
    fields: Array<{
      id: string;
      field_key: string;
      field_type: string;
      page_index: number;
      rect: { x: number; y: number; width: number; height: number };
      signer_role_key: string | null;
    }>;
  } | null;
}

interface ProjectForAuth {
  creator_id: string | null;
  organization_id: string | null;
}

type PostgrestErrorLike = {
  code?: string;
  message?: string;
  details?: string;
};

function asLowerErrorText(error: PostgrestErrorLike | null | undefined): string {
  return `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
}

function isMissingColumnSignatureFileUrlError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  const text = asLowerErrorText(error);
  return (error.code === '42703' || text.includes('does not exist')) && text.includes('signature_file_url');
}

function isNoRowsError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error || error.code !== 'PGRST116') return false;
  const text = asLowerErrorText(error);
  return text.includes('0 rows') || text.includes('no rows');
}

function isInvalidUuidError(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  const text = asLowerErrorText(error);
  return error.code === '22P02' || text.includes('invalid input syntax for type uuid');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ signatureId: string }> }
) {
  const { signatureId } = await params;
  const adminClient = getAdminClient();
  const { user } = await getAuthUser();

  // 1. Load waiver signature record
  // Phase 1: Schema-tolerant query - try with signature_file_url first (for Priority 4 legacy support),
  // retry without it if column doesn't exist (postgres error 42703)
  const baseSelectClause = `
      id,
      user_id,
      anonymous_id,
      waiver_pdf_url,
      signature_payload,
      signature_storage_path,
      signed_at,
      upload_storage_path,
      signature_text,
      waiver_definition_id,
      project_id,
      signup_id,
      waiver_definition:waiver_definitions (
        id,
        pdf_public_url,
        signers:waiver_definition_signers (
          id,
          role_key,
          label,
          required,
          order_index
        ),
        fields:waiver_definition_fields (
          id,
          field_key,
          field_type,
          page_index,
          rect,
          signer_role_key
        )
      )
    `;

  // Try with signature_file_url first (for schemas that still have it)
  let selectClause = baseSelectClause.trim() + ',\n      signature_file_url';
  
  let { data: signature, error: sigError } = await adminClient
    .from('waiver_signatures')
    .select(selectClause)
    .eq('id', signatureId)
    .single();

  // If we get a missing column error, retry without signature_file_url
  if (isMissingColumnSignatureFileUrlError(sigError)) {
    selectClause = baseSelectClause.trim();
    const retry = await adminClient
      .from('waiver_signatures')
      .select(selectClause)
      .eq('id', signatureId)
      .single();
    signature = retry.data;
    sigError = retry.error;
  }

  const shouldAttemptSignupFallback =
    (!signature && !sigError) || isNoRowsError(sigError) || isInvalidUuidError(sigError);

  if (shouldAttemptSignupFallback) {
    // Compatibility fallback: sometimes clients pass signupId instead of signatureId.
    // Attempt lookup by signup_id for a smoother UX.
    const fallback = await adminClient
      .from('waiver_signatures')
      .select(selectClause)
      .eq('signup_id', signatureId)
      .order('signed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    signature = fallback.data;
    sigError = fallback.error;
  }

  // Phase 2: Distinguish query errors from truly missing records
  if (sigError) {
    if (isNoRowsError(sigError)) {
      return NextResponse.json({ error: 'Signature not found' }, { status: 404 });
    }
    
    // Other errors are genuine query/database failures - return 500
    console.error('Database query error in download route:', sigError);
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
  }

  if (!signature) {
    // No error, just no data found - truly missing record
    return NextResponse.json({ error: 'Signature not found' }, { status: 404 });
  }

  const typedSignature = signature as unknown as WaiverSignatureRecord;
  const resolvedSignatureId = typedSignature.id || signatureId;

  // 2. Check authorization (organizer, signer self-access, or authorized anonymous signer)
  const { data: project, error: projectError } = await adminClient
    .from('projects')
    .select('creator_id, organization_id')
    .eq('id', typedSignature.project_id)
    .single();

  if (projectError) {
    if (isNoRowsError(projectError)) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    console.error('Database query error while loading project in download route:', projectError);
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
  }

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const typedProject = project as ProjectForAuth;

  // Check authorization using centralized helper
  // Load org member data if needed
  let orgMember = null;
  if (typedProject.organization_id && user) {
    const { data, error: orgMemberError } = await adminClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', typedProject.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (orgMemberError) {
      console.error('Database query error while loading org membership in download route:', orgMemberError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }
    
    orgMember = data;
  }

  const url = new URL(request.url);
  const anonymousSignupIdParam = url.searchParams.get('anonymousSignupId');

  const authResult = checkWaiverAccess({
    currentUserId: user?.id ?? null,
    signature: {
      user_id: typedSignature.user_id,
      anonymous_id: typedSignature.anonymous_id,
    },
    project: {
      creator_id: typedProject.creator_id,
      organization_id: typedProject.organization_id,
    },
    orgMember,
    anonymousSignupIdParam,
  });

  if (!authResult.hasPermission) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // 3. Handle all signature formats with proper priority
  //    Priority 1: Uploaded full waiver (offline mode)
  //    Priority 2: Multi-signer signature_payload (online mode with PDF generation)
  //    Priority 3: Legacy signature_storage_path (pre-migration draw/type signatures)
  //    Priority 4: Very old signature_file_url (ancient public URL format)

  // Priority 1: Uploaded full waiver (offline mode)
  if (typedSignature.upload_storage_path) {
    try {
      const { data, error } = await adminClient.storage
        .from('waiver-uploads')
        .download(typedSignature.upload_storage_path);
      
      if (error || !data) {
        console.error('Uploaded waiver file not found:', error);
        return NextResponse.json({ error: 'Uploaded waiver file not found' }, { status: 404 });
      }
      
      // Phase 1 Fix Issue 4: Detect content type from file extension
      const path = typedSignature.upload_storage_path;
      let contentType = 'application/pdf'; // default
      if (path.endsWith('.png')) {
        contentType = 'image/png';
      } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      }
      
      return new NextResponse(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': getContentDisposition(false, resolvedSignatureId),
        },
      });
    } catch (error) {
      console.error('Error serving uploaded waiver:', error);
      return NextResponse.json({ error: 'Failed to serve waiver file' }, { status: 500 });
    }
  }

  // Priority 2: Multi-signer signature_payload
  // Phase 1 Fix: Multi-signer payloads with ANY method (draw/typed/upload) require PDF generation
  // Upload method here means "uploaded signature image", not full waiver upload
  const payload = typedSignature.signature_payload;
  if (payload && requiresPdfGeneration(payload)) {
    // Generate PDF on-demand
    try {
      const waiverPdfUrl = typedSignature.waiver_pdf_url || 
                           typedSignature.waiver_definition?.pdf_public_url;
      
      if (!waiverPdfUrl) {
        return NextResponse.json({ error: 'Waiver PDF not found' }, { status: 404 });
      }

      if (!typedSignature.waiver_definition) {
        return NextResponse.json({ error: 'Waiver definition not found' }, { status: 404 });
      }

      // Phase 2: Create storage resolver for signature assets
      const storageResolver = async (path: string): Promise<ArrayBuffer> => {
        // Phase 1 Fix: Robust bucket detection
        // Multi-signer signatures with upload_storage_path -> waiver-uploads (full PDFs)
        // Multi-signer signature assets (in payload) -> waiver-signatures (signature images)
        // If path came from upload_storage_path column, it's in waiver-uploads
        // Otherwise, asset paths are in waiver-signatures
        const isFullWaiverUpload = typedSignature.upload_storage_path !== null && 
                                    path === typedSignature.upload_storage_path;
        const bucket = isFullWaiverUpload ? 'waiver-uploads' : 'waiver-signatures';
        
        const { data, error } = await adminClient.storage
          .from(bucket)
          .download(path);
        
        if (error || !data) {
          throw new Error(`Failed to download signature asset from ${bucket}/${path}`);
        }
        
        return await data.arrayBuffer();
      };

      const pdfBuffer = await generateSignedWaiverPdf({
        waiverPdfUrl,
        definition: typedSignature.waiver_definition,
        signaturePayload: payload,
        storageResolver, // Phase 2: Pass resolver
      });

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': getContentDisposition(false, resolvedSignatureId),
        },
      });
    } catch (error) {
      console.error('PDF generation failed:', error);
      return NextResponse.json(
        { error: 'Failed to generate signed PDF' },
        { status: 500 }
      );
    }
  }

  // Priority 3: Legacy signature_storage_path (pre-migration format)
  if (typedSignature.signature_storage_path) {
    try {
      // Legacy signatures stored as images - need to generate stamped PDF
      const waiverPdfUrl = typedSignature.waiver_pdf_url || 
                           typedSignature.waiver_definition?.pdf_public_url;
      
      if (!waiverPdfUrl) {
        console.error('Legacy signature found but no waiver PDF URL available');
        return NextResponse.json({ error: 'Waiver PDF not found for legacy signature' }, { status: 404 });
      }

      // For legacy signatures, we may not have a full definition - use minimal setup
      const definition = typedSignature.waiver_definition || {
        id: 'legacy-definition',
        pdf_public_url: waiverPdfUrl,
        signers: [{
          id: 'legacy-signer',
          role_key: 'participant',
          label: 'Participant Signature',
          required: true,
          order_index: 0,
        }],
        fields: [{
          id: 'legacy-field',
          field_key: 'participant_signature',
          field_type: 'signature' as const,
          page_index: 0,
          rect: { x: 100, y: 650, width: 250, height: 60 },
          signer_role_key: 'participant',
        }],
      };

      // Construct minimal payload for legacy signature
      const legacyPayload: SignaturePayload = {
        signers: [{
          role_key: 'participant',
          method: 'draw', // Legacy signatures are typically drawn
          data: typedSignature.signature_storage_path, // Storage path
          timestamp: typedSignature.signed_at || new Date().toISOString(),
        }],
        fields: {},
      };

      // Storage resolver for legacy signature
      const storageResolver = async (path: string): Promise<ArrayBuffer> => {
        const { data, error } = await adminClient.storage
          .from('waiver-signatures')
          .download(path);
        
        if (error || !data) {
          throw new Error(`Failed to download legacy signature from waiver-signatures/${path}`);
        }
        
        return await data.arrayBuffer();
      };

      const pdfBuffer = await generateSignedWaiverPdf({
        waiverPdfUrl,
        definition,
        signaturePayload: legacyPayload,
        storageResolver,
      });

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': getContentDisposition(false, resolvedSignatureId),
        },
      });
    } catch (error) {
      console.error('Legacy signature PDF generation failed:', error);
      return NextResponse.json(
        { error: 'Failed to generate PDF for legacy signature' },
        { status: 500 }
      );
    }
  }

  // Priority 4: Very old signature_file_url format
  if (typedSignature.signature_file_url) {
    // Very old format - public URL to signature, just redirect
    return NextResponse.redirect(typedSignature.signature_file_url);
  }

  // Priority 5: Legacy signature_text format (Phase 1 legacy compatibility)
  if (typedSignature.signature_text) {
    try {
      const waiverPdfUrl = typedSignature.waiver_pdf_url || 
                           typedSignature.waiver_definition?.pdf_public_url;
      
      if (!waiverPdfUrl) {
         return NextResponse.json({ error: 'Waiver PDF not found for typed signature' }, { status: 404 });
      }

      const definition = typedSignature.waiver_definition || {
        id: 'legacy-typed-definition',
        pdf_public_url: waiverPdfUrl,
        signers: [{
          id: 'legacy-signer',
          role_key: 'participant',
          label: 'Participant Signature',
          required: true,
          order_index: 0,
        }],
        fields: [{
          id: 'legacy-field',
          field_key: 'participant_signature',
          field_type: 'signature' as const,
          page_index: 0,
          rect: { x: 100, y: 650, width: 250, height: 60 },
          signer_role_key: 'participant',
        }],
      };

      const legacyPayload: SignaturePayload = {
        signers: [{
          role_key: 'participant',
          method: 'typed',
          data: typedSignature.signature_text,
          timestamp: typedSignature.signed_at || new Date().toISOString(),
        }],
        fields: {},
      };

      const pdfBuffer = await generateSignedWaiverPdf({
        waiverPdfUrl,
        definition,
        signaturePayload: legacyPayload,
      });

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': getContentDisposition(false, resolvedSignatureId),
        },
      });
    } catch (error) {
      console.error('Legacy typed signature PDF generation failed:', error);
      return NextResponse.json({ error: 'Failed to generate PDF for typed signature' }, { status: 500 });
    }
  }

  // No signature data found
  console.error('No signature data found for signature ID:', signatureId);
  return NextResponse.json({ error: 'Signature file not found' }, { status: 404 });
}
