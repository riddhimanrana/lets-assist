'use server';

import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-helpers';
import { getAdminClient } from '@/lib/supabase/admin';
import { buildSignaturePreviewSummary } from '@/lib/waiver/signature-preview';
import type { SignaturePayload, SignaturePreviewSummary } from '@/types/waiver-definitions';

type OrganizerSignupsResult<T> =
  | { signups: T[]; error?: undefined }
  | { signups?: undefined; error: string };

type OrganizerWaiverSignatureRow = {
  id: string;
  created_at: string;
  signature_type: string;
  signature_storage_path: string | null;
  upload_storage_path: string | null;
  signature_text: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signature_payload: SignaturePayload | null;
};

type OrganizerWaiverSignatureSummaryRow = Omit<
  OrganizerWaiverSignatureRow,
  'signature_payload'
> & {
  signature_payload: null;
  signature_summary: SignaturePreviewSummary | null;
};

type OrganizerSignupRow = {
  waiver_signature?: OrganizerWaiverSignatureRow[] | OrganizerWaiverSignatureRow | null;
  [key: string]: unknown;
};

function summarizeWaiverSignature(
  signature: OrganizerWaiverSignatureRow,
): OrganizerWaiverSignatureSummaryRow {
  return {
    ...signature,
    signature_payload: null,
    signature_summary: buildSignaturePreviewSummary(signature.signature_payload),
  };
}

function summarizeNestedWaiverSignature(
  waiverSignature: OrganizerWaiverSignatureRow[] | OrganizerWaiverSignatureRow | null | undefined,
) {
  if (Array.isArray(waiverSignature)) {
    return waiverSignature.map(summarizeWaiverSignature);
  }

  if (!waiverSignature) {
    return waiverSignature ?? null;
  }

  return summarizeWaiverSignature(waiverSignature);
}

/**
 * Organizer-only signup fetch that is resilient to RLS.
 *
 * Why: The organizer signups table needs to show waiver status (presence of waiver_signatures)
 * but client-side joins can be blocked by RLS, causing false "waiver missing" badges.
 */
export async function getOrganizerSignupsWithWaiverStatus(
  projectId: string
): Promise<OrganizerSignupsResult<unknown>> {
  const supabase = await createClient();
  const { user } = await getAuthUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  const admin = getAdminClient();

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('id, creator_id, organization_id')
    .eq('id', projectId)
    .limit(1)
    .maybeSingle();

  if (projectError || !project) {
    console.error('Error loading project for signups authorization:', projectError);
    return { error: 'Project not found' };
  }

  let hasPermission = project.creator_id === user.id;

  if (!hasPermission && project.organization_id) {
    const { data: orgMember, error: orgError } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', project.organization_id)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (orgError) {
      console.error('Error checking organizer org membership:', orgError);
    }

    if (orgMember && ['admin', 'staff'].includes(orgMember.role)) {
      hasPermission = true;
    }
  }

  if (!hasPermission) {
    return { error: 'Unauthorized' };
  }

  const { data, error } = await admin
    .from('project_signups')
    .select(`
      id,
      created_at,
      status,
      user_id,
      anonymous_id,
      schedule_id,
      volunteer_comment,
      waiver_signature:waiver_signatures!waiver_signatures_signup_id_fkey (
        id,
        created_at,
        signature_type,
        signature_storage_path,
        upload_storage_path,
        signature_text,
        signed_at,
        signer_name,
        signature_payload
      ),
      profile:profiles!left (
        full_name,
        username,
        email,
        phone
      ),
      anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey (
        id,
        name,
        email,
        phone_number,
        confirmed_at
      )
    `)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading organizer signups (admin):', error);
    return { error: 'Failed to load signups' };
  }

  const summarizedSignups = ((data as OrganizerSignupRow[] | null) ?? []).map((signup) => ({
    ...signup,
    waiver_signature: summarizeNestedWaiverSignature(signup.waiver_signature),
  }));

  return { signups: summarizedSignups };
}
