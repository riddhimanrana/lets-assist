# Database Migrations

## Phase 1: Profile Privacy & CIPA Compliance

### Running the Migration

This migration adds CIPA compliance fields to the `profiles` table.

#### Option 1: Via Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `001_add_profile_privacy_columns.sql`
4. Paste into the SQL editor and run

#### Option 2: Via Supabase CLI

```bash
supabase db push
```

#### Option 3: Manual SQL Execution

```bash
psql -h your-database-host -U your-username -d your-database -f scripts/migrations/001_add_profile_privacy_columns.sql
```

### What This Migration Does

- ✅ Adds `is_school_account` - Boolean flag for school email domains
- ✅ Adds `profile_visibility` - Controls profile visibility (public/private/organization_only)
- ✅ Adds `data_collection_consent` - User consent for data collection (COPPA)
- ✅ Adds `parent_consent_verified` - Parental consent for users under 13
- ✅ Adds `date_of_birth` - Required for age verification
- ✅ Adds `age_verification_status` - Tracks age verification status
- ✅ Adds `organization_id` - Links profile to an organization
- ✅ Creates indexes for better query performance

### Verification

After running the migration, verify it was successful:

```sql
-- Check if columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN (
  'is_school_account', 
  'profile_visibility', 
  'data_collection_consent',
  'parent_consent_verified',
  'date_of_birth',
  'age_verification_status',
  'organization_id'
);

-- Check if indexes exist
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'profiles'
AND indexname LIKE 'idx_profiles_%';
```

### Rollback (if needed)

If you need to rollback this migration:

```sql
-- Remove columns
ALTER TABLE profiles
DROP COLUMN IF EXISTS is_school_account,
DROP COLUMN IF EXISTS profile_visibility,
DROP COLUMN IF EXISTS data_collection_consent,
DROP COLUMN IF EXISTS parent_consent_verified,
DROP COLUMN IF EXISTS date_of_birth,
DROP COLUMN IF EXISTS age_verification_status,
DROP COLUMN IF EXISTS organization_id;

-- Remove indexes
DROP INDEX IF EXISTS idx_profiles_school_account;
DROP INDEX IF EXISTS idx_profiles_visibility;
DROP INDEX IF EXISTS idx_profiles_organization;
DROP INDEX IF EXISTS idx_profiles_age_verification;
```

### Next Steps

After running this migration:

1. Update your database trigger to handle the new fields from user metadata
2. Test signup flow with different email domains
3. Verify privacy settings are being applied correctly
4. Test profile visibility logic

## Database Trigger Update

You'll need to update your database trigger that creates/updates profiles from auth.users metadata to include the new fields:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    email, 
    full_name, 
    username, 
    avatar_url,
    created_at,
    is_school_account,
    profile_visibility,
    data_collection_consent,
    parent_consent_verified,
    date_of_birth,
    age_verification_status
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_user_meta_data->>'created_at', NOW()::TEXT),
    COALESCE((NEW.raw_user_meta_data->>'is_school_account')::BOOLEAN, FALSE),
    COALESCE(NEW.raw_user_meta_data->>'profile_visibility', 'public'),
    COALESCE((NEW.raw_user_meta_data->>'data_collection_consent')::BOOLEAN, TRUE),
    COALESCE((NEW.raw_user_meta_data->>'parent_consent_verified')::BOOLEAN, FALSE),
    (NEW.raw_user_meta_data->>'date_of_birth')::DATE,
    COALESCE(NEW.raw_user_meta_data->>'age_verification_status', 'pending')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    username = COALESCE(EXCLUDED.username, public.profiles.username),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    is_school_account = COALESCE(EXCLUDED.is_school_account, public.profiles.is_school_account),
    profile_visibility = COALESCE(EXCLUDED.profile_visibility, public.profiles.profile_visibility),
    data_collection_consent = COALESCE(EXCLUDED.data_collection_consent, public.profiles.data_collection_consent),
    parent_consent_verified = COALESCE(EXCLUDED.parent_consent_verified, public.profiles.parent_consent_verified),
    date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
    age_verification_status = COALESCE(EXCLUDED.age_verification_status, public.profiles.age_verification_status);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```
