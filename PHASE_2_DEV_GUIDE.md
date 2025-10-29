# Phase 2 Developer Quick Reference

## 🚀 Quick Start for Developers

This guide provides a quick reference for developers working with the Phase 2 CIPA compliance features.

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Key Components](#key-components)
3. [Server Actions](#server-actions)
4. [Middleware Flow](#middleware-flow)
5. [Database Schema](#database-schema)
6. [Utility Functions](#utility-functions)
7. [Common Tasks](#common-tasks)
8. [Debugging Tips](#debugging-tips)
9. [Testing Locally](#testing-locally)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Sign Up                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  Email Verification    │
            └────────────┬───────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │   OAuth Callback       │
            │  (Institution Check)   │
            └────────────┬───────────┘
                         │
         ┌───────────────┴──────────────┐
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌──────────────────┐
│ Institution?    │    NO    │  Regular User    │
│ domain detected │─────────▶│  Full Access     │
└────────┬────────┘          └──────────────────┘
         │ YES
         ▼
┌─────────────────┐
│ DOB Onboarding  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Age < 13?       │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  YES        NO
    │         │
    ▼         ▼
┌─────────┐ ┌──────────────┐
│Parental │ │ Full Access  │
│Consent  │ │ (Private)    │
└────┬────┘ └──────────────┘
     │
     ▼
┌─────────────────┐
│Parent Approves  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Full Access    │
│  (Private)      │
└─────────────────┘
```

---

## Key Components

### 1. DOB Onboarding

**Location**: `app/auth/dob-onboarding/`

**Files**:
- `page.tsx` - Server component that checks auth and institution status
- `DOBOnboardingForm.tsx` - Client component with calendar picker
- `actions.ts` - Server actions for DOB submission

**Key Logic**:
```typescript
// Check if institution email
const isInstitution = await isInstitutionEmail(email);

// Calculate age and settings
const age = calculateAge(dateOfBirth);
const profileVisibility = getDefaultProfileVisibility(dateOfBirth, isInstitution);
const requiresParentalConsent = isUnder13(dateOfBirth);

// Update profile
await supabase.from('profiles').update({
  date_of_birth: dateOfBirth,
  profile_visibility: profileVisibility,
  parental_consent_required: requiresParentalConsent,
  parental_consent_verified: !requiresParentalConsent,
});
```

### 2. Parental Consent Request

**Location**: `app/account/parental-consent/`

**Files**:
- `page.tsx` - Shows consent request form or pending status
- `ParentalConsentRequestForm.tsx` - Form to send consent request
- `actions.ts` - Server actions for sending consent emails

**Key Logic**:
```typescript
// Generate secure token
const token = generateConsentToken(); // 32-byte random hex

// Create consent record
await supabase.from('parental_consents').insert({
  student_id,
  parent_name,
  parent_email,
  token,
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  status: 'pending'
});

// Send email via Resend
await resend.emails.send({
  to: parentEmail,
  subject: `Parental Consent Request for ${studentName}`,
  html: consentEmailTemplate
});
```

### 3. Parental Consent Approval

**Location**: `app/parental-consent/[token]/`

**Files**:
- `page.tsx` - Public page for parents to review consent
- `ParentalConsentApprovalForm.tsx` - Approval/denial interface

**Key Logic**:
```typescript
// Verify token
const { data: consent } = await supabase
  .from('parental_consents')
  .select('*')
  .eq('token', token)
  .single();

// Check expiration
if (new Date(consent.expires_at) < new Date()) {
  return { error: 'Link expired' };
}

// Approve consent
await supabase.from('parental_consents').update({
  status: 'approved',
  approved_at: new Date().toISOString()
}).eq('token', token);

// Update student profile
await supabase.from('profiles').update({
  parental_consent_verified: true
}).eq('id', consent.student_id);
```

### 4. Middleware (Access Control)

**Location**: `middleware.ts` (root)

**Flow**:
```typescript
1. Check if route is public → Allow
2. Check if user is authenticated → Redirect to login
3. Check if institution user needs DOB → Redirect to onboarding
4. Check if under-13 needs consent → Redirect to consent
5. Allow access
```

**Public Routes**:
- `/`, `/login`, `/signup`, `/privacy`, `/terms`
- `/contact`, `/help`, `/acknowledgements`
- `/auth/*`, `/parental-consent/*`
- Static files (`/_next`, `/api`, images)

---

## Server Actions

### submitDOBOnboarding
```typescript
// app/auth/dob-onboarding/actions.ts
async function submitDOBOnboarding(userId: string, dateOfBirth: string)
```
- Validates user authentication
- Calculates age from DOB
- Applies age-based settings
- Returns `{ success: true, requiresParentalConsent: boolean }`

### sendParentalConsentRequest
```typescript
// app/account/parental-consent/actions.ts
async function sendParentalConsentRequest({
  studentId,
  studentName,
  studentEmail,
  parentEmail,
  parentName
})
```
- Generates secure token
- Creates consent record
- Sends email via Resend
- Returns `{ success: true, consentId: string }`

### verifyConsentToken
```typescript
// app/account/parental-consent/actions.ts
async function verifyConsentToken(token: string)
```
- Validates token exists
- Checks expiration
- Checks status
- Returns consent details or error

### approveParentalConsent
```typescript
// app/account/parental-consent/actions.ts
async function approveParentalConsent(token: string, ipAddress?: string)
```
- Updates consent status to 'approved'
- Updates student profile
- Sends confirmation email
- Returns `{ success: true }`

### denyParentalConsent
```typescript
// app/account/parental-consent/actions.ts
async function denyParentalConsent(token: string, reason?: string)
```
- Updates consent status to 'denied'
- Stores denial reason
- Returns `{ success: true }`

---

## Middleware Flow

```typescript
// middleware.ts
export async function middleware(request: NextRequest) {
  // 1. Create Supabase client
  const supabase = createServerClient(...)
  
  // 2. Get authenticated user
  const { data: { user } } = await supabase.auth.getUser()
  
  // 3. Check public routes
  if (isPublicRoute(pathname)) return response
  
  // 4. Require authentication
  if (!user) return redirect('/login')
  
  // 5. Check DOB requirement (institution only)
  if (!profile.date_of_birth && isInstitutionEmail(profile.email)) {
    return redirect('/auth/dob-onboarding')
  }
  
  // 6. Check parental consent (under 13)
  if (needsParentalConsent(profile)) {
    return redirect('/account/parental-consent')
  }
  
  // 7. Allow access
  return response
}
```

---

## Database Schema

### profiles (modified)
```sql
ALTER TABLE profiles ADD COLUMN date_of_birth DATE;
ALTER TABLE profiles ADD COLUMN age_verified_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN parental_consent_required BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN parental_consent_verified BOOLEAN DEFAULT false;
```

### educational_institutions
```sql
CREATE TABLE educational_institutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_institutions_domain ON educational_institutions(domain);
```

### parental_consents
```sql
CREATE TABLE parental_consents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  parent_name TEXT NOT NULL,
  parent_email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending', -- pending/approved/denied/superseded
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  denial_reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_consents_token ON parental_consents(token);
CREATE INDEX idx_consents_student ON parental_consents(student_id);
```

---

## Utility Functions

### Age Helpers (`utils/age-helpers.ts`)

```typescript
// Calculate age from date of birth
calculateAge(dateOfBirth: string | Date): number

// Check if user is under 13
isUnder13(dateOfBirth: string | Date | null): boolean

// Check if user is between 13-17
isTeen(dateOfBirth: string | Date | null): boolean

// Check if user is 18+
isAdult(dateOfBirth: string | Date | null): boolean
```

### Profile Settings (`utils/settings/profile-settings.ts`)

```typescript
// Check if email is from institution
isInstitutionEmail(email: string): Promise<boolean>

// Get default visibility based on age
getDefaultProfileVisibility(
  dateOfBirth: string | Date | null,
  isInstitutionAccount: boolean
): 'public' | 'private'

// Check if user can change visibility
canChangeProfileVisibility(dateOfBirth: string | Date | null): boolean

// Apply visibility constraints (force private for <13)
applyVisibilityConstraints(
  visibility: 'public' | 'private',
  dateOfBirth: string | Date | null
): 'public' | 'private'
```

### Access Control (`utils/settings/access-control.ts`)

```typescript
// Check if user can access a project
canAccessProject(userId: string, projectId: string): Promise<AccessControlResult>

// Check if user can create projects (13+)
canCreateProject(userId: string): Promise<AccessControlResult>

// Check if user needs parental consent
needsParentalConsent(userId: string): Promise<boolean>

// Check if account is restricted
isAccountRestricted(userId: string): Promise<boolean>

// Global access check for middleware
checkUserAccess(userId: string): Promise<{
  canAccess: boolean,
  redirectTo?: string,
  reason?: string
}>
```

---

## Common Tasks

### Add a New Institution Domain

```typescript
// Via Supabase SQL Editor or admin panel
await supabase.from('educational_institutions').insert({
  name: 'Example High School',
  domain: 'example.edu',
  verified: true
});
```

### Check User's Consent Status

```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('parental_consent_required, parental_consent_verified')
  .eq('id', userId)
  .single();

if (profile.parental_consent_required && !profile.parental_consent_verified) {
  console.log('User needs parental consent');
}
```

### Manually Approve Consent (Admin)

```typescript
// Update consent record
await supabase
  .from('parental_consents')
  .update({
    status: 'approved',
    approved_at: new Date().toISOString()
  })
  .eq('student_id', studentId)
  .eq('status', 'pending');

// Update profile
await supabase
  .from('profiles')
  .update({ parental_consent_verified: true })
  .eq('id', studentId);
```

### Reset User's DOB (Support Request)

```typescript
// Clear DOB fields
await supabase
  .from('profiles')
  .update({
    date_of_birth: null,
    age_verified_at: null,
    parental_consent_required: false,
    parental_consent_verified: false
  })
  .eq('id', userId);

// User will go through onboarding again
```

---

## Debugging Tips

### User Stuck on DOB Onboarding

**Check**:
1. Is their email from a verified institution?
   ```sql
   SELECT * FROM educational_institutions WHERE domain = 'user-domain.com';
   ```
2. Has profile been created?
   ```sql
   SELECT id, email, date_of_birth FROM profiles WHERE id = 'user-id';
   ```

**Fix**: Add institution domain or clear DOB to retry

### Parent Says They Didn't Receive Email

**Check**:
1. Resend API key configured?
2. Check Resend dashboard for delivery status
3. Check spam folder
4. Verify parent email in database:
   ```sql
   SELECT * FROM parental_consents WHERE student_id = 'user-id' ORDER BY created_at DESC;
   ```

**Fix**: Send new consent request with correct email

### Consent Link Shows "Invalid"

**Check**:
1. Token exists in database
2. Link hasn't expired (7 days)
3. Status is still 'pending'
   ```sql
   SELECT * FROM parental_consents WHERE token = 'token-value';
   ```

**Fix**: Send new consent request if expired or used

### User Can't Access Dashboard

**Check**:
1. Authentication status
2. DOB completion: `SELECT date_of_birth FROM profiles WHERE id = 'user-id'`
3. Consent status: `SELECT parental_consent_required, parental_consent_verified FROM profiles WHERE id = 'user-id'`
4. Check middleware redirects in browser network tab

**Fix**: Complete missing onboarding steps

---

## Testing Locally

### Setup Test Institution

```sql
INSERT INTO educational_institutions (name, domain, verified)
VALUES ('Test High School', 'test.edu', true);
```

### Test Under-13 Flow

```typescript
// 1. Sign up with test.edu email
// 2. Complete DOB onboarding with DOB making user 11 years old
// 3. Verify redirect to parental consent
// 4. Send consent to your test email
// 5. Open consent link from email
// 6. Approve consent
// 7. Log back in as student
// 8. Verify dashboard access
```

### Test Teen Flow (13-17)

```typescript
// 1. Sign up with test.edu email
// 2. Complete DOB onboarding with DOB making user 15 years old
// 3. Verify immediate dashboard access
// 4. Check profile visibility is 'private'
```

### Test Adult Flow (18+)

```typescript
// 1. Sign up with test.edu email
// 2. Complete DOB onboarding with DOB making user 20 years old
// 3. Verify immediate dashboard access
// 4. Check profile visibility is 'public'
```

### Test Regular User Flow

```typescript
// 1. Sign up with gmail.com email
// 2. Verify email
// 3. Verify immediate dashboard access
// 4. No DOB or consent required
```

### Mock Email Testing

```typescript
// Use Resend test mode or Mailtrap for development
// Set in .env.local:
RESEND_API_KEY=re_test_xxx
```

---

## Environment Variables

### Required
```bash
RESEND_API_KEY=re_xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### Optional (Development)
```bash
NODE_ENV=development
NEXT_PUBLIC_DEBUG_MODE=true
```

---

## Error Messages Reference

| Error | Cause | Solution |
|-------|-------|----------|
| "Unauthorized" | User not authenticated | Check auth token |
| "Profile not found" | User profile missing | Verify OAuth callback created profile |
| "Invalid consent link" | Token doesn't exist | Send new consent request |
| "This consent link has expired" | > 7 days old | Send new consent request |
| "Parental consent required" | Under 13 without consent | Complete parental consent flow |
| "Must be 13 or older to create projects" | Project creation by <13 | Wait for approval or age verification |

---

## Quick Reference: What to Check When...

### User reports "stuck" in onboarding
1. ✅ Check middleware logs
2. ✅ Verify profile data in Supabase
3. ✅ Check institution domain verification
4. ✅ Review browser console for errors

### Email not delivering
1. ✅ Check Resend dashboard
2. ✅ Verify API key
3. ✅ Check email address validity
4. ✅ Review spam folder
5. ✅ Check DNS/SPF records

### Consent not working
1. ✅ Verify token in database
2. ✅ Check expiration date
3. ✅ Verify status is 'pending'
4. ✅ Check RLS policies

### Performance issues
1. ✅ Check middleware response times
2. ✅ Verify database indexes
3. ✅ Monitor Supabase queries
4. ✅ Check Next.js build warnings

---

## Resources

- **Phase 2 Status**: `PHASE_2_STATUS.md`
- **Testing Guide**: `PHASE_2_TESTING.md`
- **Complete Summary**: `PHASE_2_COMPLETE.md`
- **Compliance Plan**: `CIPA_COMPLIANCE_PLAN_V2.md`

---

## Support

For questions or issues:
- Slack: #cipa-implementation
- Email: engineering@letsassist.org
- Docs: https://docs.letsassist.org

---

**Last Updated**: December 2024  
**Maintained By**: Engineering Team