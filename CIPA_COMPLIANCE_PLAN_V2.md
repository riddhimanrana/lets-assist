# CIPA Compliance Implementation Plan for Let's Assist (v2 - Simplified)

**Version:** 2.0  
**Updated:** 2024  
**Key Changes:** No Supabase functions, simplified DB schema, Vercel AI Gateway, GitHub Actions for moderation

---

## 🎯 Implementation Phases

### Phase 1: Database Setup
- Create tables and add columns
- No application logic yet
- Pure SQL migrations

### Phase 2: Application Logic
- Create helper utilities
- Update authentication flow
- Build parental consent system

### Phase 3: Moderation & Admin
- AI moderation service
- GitHub Actions setup
- Admin dashboard

---

## Phase 1: Database Changes

### 1.1 Profiles Table Updates

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS (
  date_of_birth DATE,
  age_verified_at TIMESTAMPTZ,
  parental_consent_required BOOLEAN DEFAULT false,
  parental_consent_verified BOOLEAN DEFAULT false,
  parental_consent_verified_at TIMESTAMPTZ,
  parental_consent_token UUID,
  parent_email VARCHAR(255),
  profile_visibility VARCHAR(50) DEFAULT 'private'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_dob ON profiles(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_profiles_parental_consent ON profiles(parental_consent_required, parental_consent_verified);
CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON profiles(profile_visibility);
```

### 1.2 Organizations Table Updates

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS (
  institution_affiliation UUID REFERENCES educational_institutions(id)
);

CREATE INDEX IF NOT EXISTS idx_orgs_affiliation ON organizations(institution_affiliation);
```

### 1.3 Educational Institutions Table

```sql
CREATE TABLE IF NOT EXISTS educational_institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) NOT NULL UNIQUE,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institutions_domain ON educational_institutions(domain);
```

### 1.4 Moderation Tables

```sql
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES auth.users(id),
  content_type VARCHAR(50) NOT NULL,
  content_id UUID NOT NULL,
  reason VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'normal',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type VARCHAR(50) NOT NULL,
  content_id UUID NOT NULL,
  content_url TEXT,
  flag_type VARCHAR(50) NOT NULL,
  flag_source VARCHAR(50),
  confidence_score DECIMAL(5,4),
  flagged_categories JSONB,
  flag_details JSONB,
  status VARCHAR(50) DEFAULT 'pending',
  auto_action VARCHAR(50),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parental_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_name VARCHAR(255) NOT NULL,
  parent_email VARCHAR(255) NOT NULL,
  parent_relationship VARCHAR(50),
  consent_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  consent_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  form_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON content_reports(status, priority);
CREATE INDEX IF NOT EXISTS idx_content_flags_status ON content_flags(status);
CREATE INDEX IF NOT EXISTS idx_content_flags_type ON content_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_consents_user ON parental_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_consents_token ON parental_consents(consent_token);
```

### 1.5 Row Level Security (RLS)

```sql
-- Enable RLS on all new tables
ALTER TABLE educational_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE parental_consents ENABLE ROW LEVEL SECURITY;

-- educational_institutions: Public read, admin write
CREATE POLICY "Allow public read" ON educational_institutions
  FOR SELECT USING (true);

CREATE POLICY "Allow admin write" ON educational_institutions
  FOR INSERT WITH CHECK (auth.jwt() ->> 'is_super_admin' = 'true');

CREATE POLICY "Allow admin update" ON educational_institutions
  FOR UPDATE USING (auth.jwt() ->> 'is_super_admin' = 'true');

-- content_reports: Users can create, admin can review
CREATE POLICY "Allow users to create reports" ON content_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id OR reporter_id IS NULL);

CREATE POLICY "Allow users to view their own reports" ON content_reports
  FOR SELECT USING (auth.uid() = reporter_id OR auth.jwt() ->> 'is_super_admin' = 'true');

CREATE POLICY "Allow admin to update reports" ON content_reports
  FOR UPDATE USING (auth.jwt() ->> 'is_super_admin' = 'true');

-- content_flags: Admin read/write only
CREATE POLICY "Allow admin to view flags" ON content_flags
  FOR SELECT USING (auth.jwt() ->> 'is_super_admin' = 'true');

CREATE POLICY "Allow system to insert flags" ON content_flags
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow admin to update flags" ON content_flags
  FOR UPDATE USING (auth.jwt() ->> 'is_super_admin' = 'true');

-- parental_consents: User can view their own, admin can view all, service role handles updates
CREATE POLICY "Allow users to view their own consents" ON parental_consents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Allow admin to view all consents" ON parental_consents
  FOR SELECT USING (auth.jwt() ->> 'is_super_admin' = 'true');

CREATE POLICY "Allow system to insert consents" ON parental_consents
  FOR INSERT WITH CHECK (true);

-- Service role (used in server actions) bypasses RLS for updates
CREATE POLICY "Allow service role to update" ON parental_consents
  FOR UPDATE USING (true);
```

### 1.6 Initial Data

```sql
-- Insert SRVUSD institution
INSERT INTO educational_institutions (name, domain, verified)
VALUES ('San Ramon Valley Unified School District', 'students.srvusd.net', true);
```

---

## Phase 2: Application Logic

### 2.1 Helper Utilities

#### `utils/age-helpers.ts`

```typescript
export function calculateAge(dateOfBirth: string | Date | null): number {
  if (!dateOfBirth) return -1;
  
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

export const isUnder13 = (dob: string | Date | null) => calculateAge(dob) < 13;
export const isMinor = (dob: string | Date | null) => calculateAge(dob) < 18;
export const isTeenager = (dob: string | Date | null) => {
  const age = calculateAge(dob);
  return age >= 13 && age < 18;
};
```

#### `utils/settings/profile-settings.ts`

```typescript
import { calculateAge } from '@/utils/age-helpers';
import { createClient } from '@/utils/supabase/server';

export type ProfileVisibility = 'public' | 'private';

/**
 * Check if email is from an institution domain
 */
export async function isInstitutionEmail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  
  const supabase = await createClient();
  const { data } = await supabase
    .from('educational_institutions')
    .select('id')
    .eq('domain', domain)
    .eq('verified', true)
    .single();
  
  return !!data;
}

export function getDefaultProfileVisibility(
   dateOfBirth: string | Date | null,
   isInstitutionAccount: boolean
): ProfileVisibility {
   if (!dateOfBirth) return 'public';
   
   const age = calculateAge(dateOfBirth);
   
   // Under 13: Always private
   if (age < 13) return 'private';
   
   // 13-17: Default private
   if (age < 18) return 'private';
   
   // 18+: Default public
   return 'public';
}</parameter>

export function canChangeProfileVisibility(dateOfBirth: string | Date | null): boolean {
   if (!dateOfBirth) return true;
   const age = calculateAge(dateOfBirth);
   // Only under 13 cannot change (they're locked to private)
   return age >= 13;
}</parameter>

export function applyVisibilityConstraints(
   visibility: ProfileVisibility,
   dateOfBirth: string | Date | null
): ProfileVisibility {
   if (!dateOfBirth) return visibility;
   
   const age = calculateAge(dateOfBirth);
   
   // Under 13 is always forced private
   if (age < 13) return 'private';
   
   return visibility;
}
```

#### `utils/settings/access-control.ts`

```typescript
import { calculateAge, isUnder13 } from '@/utils/age-helpers';
import { createClient } from '@/utils/supabase/server';

export async function canAccessProject(userId: string, projectId: string) {
   const supabase = await createClient();
   
   const { data: profile } = await supabase
     .from('profiles')
     .select('date_of_birth, parental_consent_verified')
     .eq('id', userId)
     .single();
   
   if (!profile) {
     return { canAccess: false, reason: 'Profile not found' };
   }
   
   // If under 13 and no parental consent, block access
   if (isUnder13(profile.date_of_birth)) {
     if (!profile.parental_consent_verified) {
       return { canAccess: false, requiresParentalConsent: true };
     }
   }
   
   return { canAccess: true };
}</parameter>
</invoke>

export async function canCreateProject(userId: string) {
  const supabase = await createClient();
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('date_of_birth')
    .eq('id', userId)
    .single();
  
  if (isUnder13(profile?.date_of_birth)) {
    return { canAccess: false, reason: 'Must be 13+ to create projects' };
  }
  
  return { canAccess: true };
}
```

### 2.2 Authentication Updates

**File: `app/signup/actions.ts` (Update)**

```typescript
'use server';

import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { isInstitutionEmail } from '@/utils/institution-helpers';
import { calculateAge, isUnder13 } from '@/utils/age-helpers';
import { getDefaultProfileVisibility } from '@/utils/settings/profile-settings';

const signupSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().optional(),
});

export async function signup(formData: FormData) {
  const validated = signupSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    dateOfBirth: formData.get('dateOfBirth'),
  });

  if (!validated.success) {
    return { error: validated.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { isInstitution, domain } = await isInstitutionEmail(validated.data.email);

  if (isInstitution && !validated.data.dateOfBirth) {
    return { error: { dateOfBirth: ['Date of birth required for institution accounts'] } };
  }

  let metadata: any = {
    full_name: validated.data.fullName,
    data_collection_consent: true,
  };

  if (validated.data.dateOfBirth) {
    const age = calculateAge(validated.data.dateOfBirth);
    metadata = {
      ...metadata,
      date_of_birth: validated.data.dateOfBirth,
      age_verified_at: new Date().toISOString(),
      profile_visibility: getDefaultProfileVisibility(validated.data.dateOfBirth, isInstitution),
      parental_consent_required: age < 13,
      parental_consent_verified: age >= 13,
    };
  } else {
    metadata = {
      ...metadata,
      profile_visibility: 'public',
      parental_consent_required: false,
      parental_consent_verified: true,
    };
  }

  const { data: { user }, error } = await supabase.auth.signUp({
    email: validated.data.email,
    password: validated.data.password,
    options: { data: metadata },
  });

  if (error) return { error: { server: [error.message] } };

  return {
    success: true,
    email: validated.data.email,
    requiresParentalConsent: validated.data.dateOfBirth ? isUnder13(validated.data.dateOfBirth) : false,
  };
}
```

### 2.3 DOB Onboarding for OAuth

**File: `app/auth/dob-onboarding/page.tsx` (New)**

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { isInstitutionEmail } from '@/utils/institution-helpers';
import DOBOnboardingForm from './DOBOnboardingForm';

export default async function DOBOnboardingPage() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('date_of_birth, email')
    .eq('id', user.id)
    .single();
  
  if (!profile?.date_of_birth) {
    const { isInstitution } = await isInstitutionEmail(profile?.email || '');
    
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <h1 className="text-3xl font-bold mb-2">Complete Your Profile</h1>
          <p className="text-muted-foreground mb-6">
            {isInstitution 
              ? 'As a student account, we need your date of birth.'
              : 'Please provide your date of birth to complete your profile.'}
          </p>
          
          <DOBOnboardingForm userId={user.id} />
        </div>
      </div>
    );
  }
  
  redirect('/dashboard');
}
```

### 2.4 Parental Consent System

**File: `app/account/parental-consent/page.tsx` (New)**

```typescript
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import ParentalConsentForm from './ParentalConsentForm';

export default async function ParentalConsentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) redirect('/login');
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  
  return (
    <div className="container max-w-2xl py-8">
      <h1 className="text-3xl font-bold mb-4">Request Parental Consent</h1>
      
      <ParentalConsentForm userId={user.id} />
    </div>
  );
}
```

**File: `app/parental-consent/[token]/page.tsx` (New)**

```typescript
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import ConsentFormView from './ConsentFormView';

export default async function ParentalConsentFormPage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = await createClient();
  
  const { data: consent } = await supabase
    .from('parental_consents')
    .select('*')
    .eq('consent_token', params.token)
    .single();
  
  if (!consent || consent.status !== 'pending') {
    notFound();
  }
  
  if (new Date(consent.expires_at) < new Date()) {
    return <div>This consent request has expired.</div>;
  }
  
  return <ConsentFormView consent={consent} />;
}
```

---

## Phase 3: Moderation & Admin

### 3.1 AI Moderation Service

#### `services/ai-moderation.ts`

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';

const ModerationSchema = z.object({
  flagged: z.boolean(),
  categories: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

export async function moderateText(text: string) {
  try {
    const { object } = await generateObject({
      model: 'gpt-4-turbo',
      schema: ModerationSchema,
      prompt: `Check for: violence, hate_speech, sexual, drugs, weapons. Text: "${text}"`,
    });
    return object;
  } catch (error) {
    console.error('Moderation error:', error);
    return { flagged: false, categories: [], confidence: 0 };
  }
}

export async function moderateImage(imageUrl: string) {
  try {
    const { object } = await generateObject({
      model: 'gpt-4-vision',
      schema: ModerationSchema,
      prompt: `Check image for: violence, nudity, hate, weapons, drugs. URL: ${imageUrl}`,
      vision: { type: 'image_url', url: imageUrl },
    });
    return object;
  } catch (error) {
    console.error('Image moderation error:', error);
    return { flagged: false, categories: [], confidence: 0 };
  }
}

export async function storeModerationFlag(
  contentType: string,
  contentId: string,
  result: z.infer<typeof ModerationSchema>,
  contentUrl?: string
) {
  if (!result.flagged) return null;
  
  const supabase = await createClient();
  
  return await supabase
    .from('content_flags')
    .insert({
      content_type: contentType,
      content_id: contentId,
      content_url: contentUrl,
      flag_type: 'ai',
      flag_source: 'vercel-ai-gateway',
      confidence_score: result.confidence,
      flagged_categories: result.categories,
      flag_details: result,
      status: 'pending',
      auto_action: result.confidence > 0.9 ? 'hidden' : 'none',
    })
    .select()
    .single();
}
```

### 3.2 GitHub Actions Workflows

#### `.github/workflows/moderate-projects.yml`

```yaml
name: Moderate Projects Hourly

on:
  schedule:
    - cron: '0 * * * *'

jobs:
  moderate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm ci
      
      - name: Moderate unreviewed projects
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: npx ts-node scripts/moderate-projects.ts
```

#### `.github/workflows/moderate-images.yml`

```yaml
name: Moderate Images Hourly

on:
  schedule:
    - cron: '15 * * * *'

jobs:
  moderate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm ci
      
      - name: Scan project images
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: npx ts-node scripts/moderate-images.ts
```

### 3.3 Moderation Scripts

#### `scripts/moderate-projects.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
import { moderateText, storeModerationFlag } from '@/services/ai-moderation';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function moderateProjects() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const { data: projects } = await supabase
    .from('projects')
    .select('id, title, description')
    .gte('created_at', oneHourAgo.toISOString())
    .is('moderated_at', null)
    .limit(50);
  
  let flaggedCount = 0;
  
  for (const project of projects || []) {
    const result = await moderateText(`${project.title}\n${project.description}`);
    
    if (result.flagged) {
      await storeModerationFlag('project', project.id, result);
      flaggedCount++;
      
      if (result.confidence > 0.9) {
        await supabase
          .from('projects')
          .update({ status: 'cancelled' })
          .eq('id', project.id);
      }
    }
    
    await supabase
      .from('projects')
      .update({ moderated_at: new Date().toISOString() })
      .eq('id', project.id);
  }
  
  console.log(`✅ Moderated ${projects?.length || 0} projects, flagged ${flaggedCount}`);
}

moderateProjects().catch(console.error);
```

#### `scripts/moderate-images.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
import { moderateImage, storeModerationFlag } from '@/services/ai-moderation';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function moderateImages() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const { data: images } = await supabase
    .from('projects')
    .select('id, cover_image_url')
    .gte('created_at', oneHourAgo.toISOString())
    .not('cover_image_url', 'is', null)
    .limit(50);
  
  let flaggedCount = 0;
  
  for (const image of images || []) {
    if (!image.cover_image_url) continue;
    
    const result = await moderateImage(image.cover_image_url);
    
    if (result.flagged && result.confidence > 0.7) {
      await storeModerationFlag('image', image.id, result, image.cover_image_url);
      flaggedCount++;
      
      if (result.confidence > 0.9) {
        await supabase
          .from('projects')
          .update({ is_private: true })
          .eq('id', image.id);
      }
    }
  }
  
  console.log(`✅ Moderated ${images?.length || 0} images, flagged ${flaggedCount}`);
}

moderateImages().catch(console.error);
```

### 3.4 Admin Moderation Dashboard

**File: `app/admin/moderation/page.tsx` (New)**

```typescript
import { createClient } from '@/utils/supabase/server';
import { isSuperAdmin } from '@/utils/admin-helpers';
import { redirect } from 'next/navigation';
import ModerationDashboard from './ModerationDashboard';

export default async function ModerationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user || !(await isSuperAdmin(user.id))) {
    redirect('/dashboard');
  }
  
  const [{ data: reports }, { data: contentFlags }, { data: consents }] = await Promise.all([
    supabase
      .from('content_reports')
      .select('*')
      .in('status', ['pending', 'under_review'])
      .order('priority', { ascending: false }),
    supabase
      .from('content_flags')
      .select('*')
      .eq('status', 'pending')
      .order('confidence_score', { ascending: false }),
    supabase
      .from('parental_consents')
      .select('*')
      .eq('status', 'pending'),
  ]);
  
  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Moderation Dashboard</h1>
      <ModerationDashboard reports={reports || []} contentFlags={contentFlags || []} consents={consents || []} />
    </div>
  );
}
```

---

## 📦 Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
RESEND_API_KEY=
```

---

## 🧪 Testing Checklist

- [ ] Regular email signup (no DOB)
- [ ] Institution email signup (DOB required)
- [ ] OAuth with institution email (DOB gate shows)
- [ ] Under 13 account restricted
- [ ] Parental consent flow works
- [ ] Profile visibility locked for <13
- [ ] Project access control enforced
- [ ] GitHub Actions moderate-projects runs hourly
- [ ] GitHub Actions moderate-images runs hourly
- [ ] Content flags appear in admin dashboard (AI and user reports)
- [ ] Super admin can review flags

---

**Total Implementation Time:** 4-5 weeks  
**Phase 1 (Database):** Week 1  
**Phase 2 (Application):** Weeks 2-3  
**Phase 3 (Moderation):** Week 4  
**Testing & Deployment:** Week 5+
---

## 🔐 RLS Policy Summary

### educational_institutions
- **SELECT:** Public (anyone can see institutions)
- **INSERT/UPDATE:** Super admin only

### content_reports
- **SELECT:** User can see own reports + super admin sees all
- **INSERT:** Users and anonymous can report
- **UPDATE:** Super admin only

### content_flags
- **SELECT:** Super admin only (don't show flags to users publicly)
- **INSERT:** System only (AI moderation or internal processes)
- **UPDATE:** Super admin only (for review/resolution)

### parental_consents
- **SELECT:** User sees own consents + super admin sees all
- **INSERT:** System only (when consent requested)
- **UPDATE:** Super admin only (to approve/reject)

