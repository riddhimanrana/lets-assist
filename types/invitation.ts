export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  import_job_id?: string | null;
  email: string;
  role: 'admin' | 'staff' | 'member';
  token: string;
  invited_by: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  invited_full_name?: string | null;
  invited_phone?: string | null;
  invited_profile_data?: Record<string, string> | null;
}

export interface OrganizationInvitationWithDetails extends OrganizationInvitation {
  inviter?: {
    full_name: string | null;
    email: string | null;
  };
  organization?: {
    name: string;
    username: string;
    logo_url?: string | null;
  };
}

export interface BulkInviteResult {
  email: string;
  success: boolean;
  error?: string;
  invitationId?: string;
}

export interface BulkInviteResponse {
  total: number;
  successful: number;
  failed: number;
  results: BulkInviteResult[];
}
