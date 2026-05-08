-- Trigger to automatically accept pending invitations when a user joins an organization
CREATE OR REPLACE FUNCTION accept_organization_invitations_on_join()
RETURNS TRIGGER AS $$
BEGIN
  -- Update pending invitations for the user's emails
  UPDATE public.organization_invitations oi
  SET 
    status = 'accepted', 
    accepted_at = NOW(), 
    accepted_by = NEW.user_id
  FROM public.user_emails ue
  WHERE oi.organization_id = NEW.organization_id
    AND oi.status = 'pending'
    AND oi.email = ue.email
    AND ue.user_id = NEW.user_id;
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS on_member_joined_accept_invitations ON public.organization_members;

-- Create the trigger
CREATE TRIGGER on_member_joined_accept_invitations
AFTER INSERT ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION accept_organization_invitations_on_join();

-- Also run an update to clean up any existing orphaned pending invitations 
-- where the user is already a member
UPDATE public.organization_invitations oi
SET 
  status = 'accepted', 
  accepted_at = COALESCE(om.joined_at, NOW()), 
  accepted_by = om.user_id
FROM public.organization_members om
JOIN public.user_emails ue ON ue.user_id = om.user_id
WHERE oi.organization_id = om.organization_id
  AND oi.status = 'pending'
  AND oi.email = ue.email;
