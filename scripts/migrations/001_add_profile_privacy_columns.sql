-- Migration: Add Profile Privacy and CIPA Compliance Fields
-- Phase 1: Profile Privacy & School Email Detection
-- Date: 2025-10-23

-- Add new columns to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS is_school_account BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) DEFAULT 'public' CHECK (profile_visibility IN ('public', 'private', 'organization_only')),
ADD COLUMN IF NOT EXISTS data_collection_consent BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS parent_consent_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS age_verification_status VARCHAR(30) CHECK (age_verification_status IN ('pending', 'verified', 'parental_consent_required', 'denied')),
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_school_account ON profiles(is_school_account);
CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON profiles(profile_visibility);
CREATE INDEX IF NOT EXISTS idx_profiles_organization ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_age_verification ON profiles(age_verification_status);

-- Add comment for documentation
COMMENT ON COLUMN profiles.is_school_account IS 'Indicates if the account is associated with a school email domain';
COMMENT ON COLUMN profiles.profile_visibility IS 'Controls who can view this profile: public, private, or organization_only';
COMMENT ON COLUMN profiles.data_collection_consent IS 'User consent for data collection (COPPA compliance)';
COMMENT ON COLUMN profiles.parent_consent_verified IS 'Whether parental consent has been obtained for users under 13 (COPPA)';
COMMENT ON COLUMN profiles.date_of_birth IS 'User date of birth for age verification';
COMMENT ON COLUMN profiles.age_verification_status IS 'Status of age verification process';
COMMENT ON COLUMN profiles.organization_id IS 'Link to organization (school, nonprofit, club)';
