-- Migration: Bulk Member Invitations
-- Allows organizations to track pending email invitations for staff and members

-- Create the organization_invitations table
CREATE TABLE IF NOT EXISTS public.organization_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL CHECK (role IN ('staff', 'member')),
    token uuid NOT NULL DEFAULT gen_random_uuid(),
    invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    accepted_at timestamptz,
    accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Create unique constraint to prevent duplicate pending invitations
CREATE UNIQUE INDEX organization_invitations_unique_pending 
ON public.organization_invitations (organization_id, email) 
WHERE status = 'pending';

-- Create index for token lookups (used during invitation acceptance)
CREATE INDEX organization_invitations_token_idx ON public.organization_invitations (token);

-- Create index for organization queries
CREATE INDEX organization_invitations_org_idx ON public.organization_invitations (organization_id, status);

-- Enable RLS
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

-- Policy: Organization admins and staff can view invitations for their organization
CREATE POLICY "Org admins and staff can view invitations"
ON public.organization_invitations
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('admin', 'staff')
    )
);

-- Policy: Organization admins can create invitations
CREATE POLICY "Org admins can create invitations"
ON public.organization_invitations
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
);

-- Policy: Organization admins can update invitations (cancel, resend)
CREATE POLICY "Org admins can update invitations"
ON public.organization_invitations
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = organization_invitations.organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
);

-- Policy: Anyone can read their own invitation by token (for acceptance flow)
CREATE POLICY "Anyone can read invitation by token"
ON public.organization_invitations
FOR SELECT
TO authenticated, anon
USING (true);

-- Policy: Service role can do anything (for server-side operations)
-- This is implicitly handled by Supabase service role

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.organization_invitations TO authenticated;
GRANT SELECT ON public.organization_invitations TO anon;
