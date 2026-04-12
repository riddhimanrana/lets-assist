-- Add show_members_publicly column to organizations table
-- Controls whether organization members are visible to the public

ALTER TABLE public.organizations
ADD COLUMN show_members_publicly boolean DEFAULT true NOT NULL;

COMMENT ON COLUMN public.organizations.show_members_publicly IS 
'Controls whether organization members list is visible to the public';
