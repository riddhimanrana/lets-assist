# Phase 2 Implementation Progress

## ✅ COMPLETED

### Step 1: Helper Utilities
- ✅ Created `utils/age-helpers.ts`
- ✅ Created `utils/settings/profile-settings.ts`
- ✅ Created `utils/settings/access-control.ts`

### Step 2.2.1: Update Signup Actions
- ✅ Updated `app/signup/actions.ts`
  - Uses new helpers
  - DOB is optional
  - Checks institution email
  - Requires DOB only for institution emails
  - Sets proper metadata

## 🔄 NEXT STEPS

### Step 2.2.2: Update SignupClient.tsx

**File:** `app/signup/SignupClient.tsx`

**Changes needed:**

1. Make DOB field optional in schema:
```typescript
const signupSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  dateOfBirth: z.string().optional(), // Make it optional
  turnstileToken: z.string().optional(),
});
```

2. Add state to track if email is institution:
```typescript
const [isInstitutionEmail, setIsInstitutionEmail] = useState(false);
```

3. Add function to check email domain:
```typescript
const checkEmailDomain = async (email: string) => {
  // Extract domain
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    setIsInstitutionEmail(false);
    return;
  }
  
  // Check if it's an institution domain
  // For now, simple check for students.srvusd.net
  // Later we can call the API
  if (domain === 'students.srvusd.net') {
    setIsInstitutionEmail(true);
  } else {
    setIsInstitutionEmail(false);
  }
};
```

4. Add onBlur to email field:
```typescript
<FormField
  control={form.control}
  name="email"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Email</FormLabel>
      <FormControl>
        <Input 
          {...field} 
          onBlur={(e) => checkEmailDomain(e.target.value)}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>
```

5. Make DOB field conditional:
```typescript
{isInstitutionEmail && (
  <FormField
    control={form.control}
    name="dateOfBirth"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Date of Birth</FormLabel>
        <FormControl>
          <Input type="date" {...field} max={new Date().toISOString().split('T')[0]} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
)}
```

**That's it!** The form will only show DOB field if they enter an institution email.

---

## 📝 TODO After Signup Client

### Step 3: DOB Onboarding (OAuth)
- [ ] Create `app/auth/dob-onboarding/page.tsx`
- [ ] Create `app/auth/dob-onboarding/DOBOnboardingForm.tsx`
- [ ] Create `app/auth/dob-onboarding/actions.ts`
- [ ] Update `app/auth/callback/route.ts`

### Step 4: Parental Consent
- [ ] Create `app/account/parental-consent/page.tsx`
- [ ] Create `app/account/parental-consent/ParentalConsentForm.tsx`
- [ ] Create `app/account/parental-consent/actions.ts`
- [ ] Create `app/parental-consent/[token]/page.tsx`
- [ ] Create `app/parental-consent/[token]/ConsentFormView.tsx`

---

## 🎯 Current Task

**Update `app/signup/SignupClient.tsx` with the changes above.**

Once that's done, let me know and we'll move to Step 3!

