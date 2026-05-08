import type {
  InvitationDeliveryStatus,
  InvitationDuration,
} from "@/lib/organization/invitation-utils";

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  import_job_id?: string | null;
  email: string;
  role: 'admin' | 'staff' | 'member';
  token: string;
  invited_by: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  invitation_duration?: InvitationDuration;
  email_delivery_status?: InvitationDeliveryStatus;
  email_delivery_error?: string | null;
  last_email_attempt_at?: string | null;
  last_email_sent_at?: string | null;
  email_message_id?: string | null;
  email_transport?: string | null;
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

export interface OrganizationInvitationsPage {
  invitations: OrganizationInvitationWithDetails[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
