# Email Verification Debug Guide

## Quick Check: Is it Working?

### Test the Flow

1. **Sign up with a new email**
   - Go to: https://lets-assist.com/signup
   - Enter: name, email, password
   - Click: Sign Up

2. **Check the verification email**
   - Check inbox (and spam folder)
   - The link should look like:
   ```
   https://api.lets-assist.com/auth/v1/verify?token=pkce_...&type=signup&redirect_to=https://lets-assist.com/auth/callback
   ```

3. **Click the verification link**
   - It will first hit: `api.lets-assist.com/auth/v1/verify` (Supabase verifies the token)
   - Then redirects to: `lets-assist.com/auth/callback?code=...&type=signup`
   - Then should redirect to: `lets-assist.com/auth/verification-success?type=signup&email=...`

4. **Check the success page**
   - Should see: ✅ "Email Verified Successfully!"
   - Should see: Your email address displayed
   - Should see: "Go to Login" button

---

## Debug Steps

### Step 1: Check Browser Console

Open Developer Tools → Console tab when you click the verification link.

Look for these logs:
```
Auth callback params: { code: 'present', type: 'signup', ... }
Email verification check: { ... }
✅ Email verification detected - redirecting to success page
Redirecting to: https://lets-assist.com/auth/verification-success?type=signup&email=...
```

**If you see `⚠️ Email verification NOT detected`**, check the log details.

### Step 2: Check URL Parameters

When the verification link redirects you, check the URL in the address bar:

**Expected**:
```
https://lets-assist.com/auth/verification-success?type=signup&email=user@example.com
```

**If you see this instead**:
```
https://lets-assist.com/home
```
or
```
https://lets-assist.com/dashboard
```

Then the callback is not detecting the email verification properly.

### Step 3: Check Console Logs

The callback logs these values:

```javascript
{
  type: "signup",                    // Should be "signup"
  isEmailVerification: true,          // Should be true
  isRecentSignup: true,               // Should be true (if < 5 min)
  hasCompletedOnboarding: false,      // Should be false
  redirectAfterAuth: null,            // Should be null/undefined
  timeSinceCreation: "30s"            // Time since user creation
}
```

### Step 4: Manual Test

If automatic detection fails, manually navigate to:
```
https://lets-assist.com/auth/verification-success?type=signup&email=yourtest@email.com
```

This should show the success page.

---

## Common Issues

### Issue 1: Redirecting to Home Instead

**Symptom**: After clicking verification link, goes to `/home` instead of `/auth/verification-success`

**Cause**: The callback is not detecting this as an email verification

**Fix**: Check these conditions in `app/auth/callback/route.ts`:
- `type` parameter should be `"signup"`
- `redirectAfterAuth` should be `null` or `undefined`
- User should be recently created (< 5 minutes)

### Issue 2: Shows "Invalid Token" Error

**Symptom**: Verification page shows "Verification Failed" or "Invalid token"

**Cause**: Token already used or expired

**Fix**: Request a new verification email:
1. Go to login page
2. Try to log in
3. Should see "Please verify your email" message
4. Click "Resend verification email"

### Issue 3: Modal Appears on Success Page

**Symptom**: Welcome onboarding modal appears on top of success page

**Cause**: Modal not suppressed on verification page

**Fix**: Check `GlobalNotificationProvider.tsx`:
```typescript
const suppressOnboardingModal = !!(
  pathname?.startsWith("/projects/create") ||
  pathname?.startsWith("/organization/create") ||
  pathname?.startsWith("/auth/dob-onboarding") ||
  pathname?.startsWith("/account/parental-consent") ||
  pathname?.startsWith("/parental-consent") ||
  pathname?.startsWith("/auth/verification-success") // ← Add this
);
```

### Issue 4: Already Logged In

**Symptom**: When clicking verification link while already logged in, it doesn't show success page

**Cause**: The callback signs out the user before showing success, but browser might have cached session

**Fix**: 
1. Log out completely
2. Click verification link again
3. Or clear browser cookies/cache

---

## Testing Checklist

- [ ] Sign up with new email
- [ ] Receive verification email
- [ ] Email link points to `api.lets-assist.com` (correct)
- [ ] Clicking link redirects to `lets-assist.com/auth/callback`
- [ ] Console shows: `✅ Email verification detected`
- [ ] Redirects to `/auth/verification-success`
- [ ] Success page shows checkmark and email
- [ ] "Go to Login" button works
- [ ] Login page has email pre-filled
- [ ] Can log in successfully
- [ ] If institution email: shows DOB onboarding
- [ ] If DOB complete: redirects to `/home`
- [ ] Welcome modal appears on `/home`

---

## Quick Fixes

### Force Show Success Page

If you need to test the success page without going through the full flow:

```bash
# Navigate to:
https://lets-assist.com/auth/verification-success?type=signup&email=test@example.com
```

### Skip Email Verification (Development Only)

In Supabase Dashboard:
1. Go to: Authentication → Providers → Email
2. Toggle OFF: "Enable email confirmations"
3. Now signups don't need verification

**Remember to turn this back ON for production!**

### Manual Profile Creation

If callback fails to create profile, create it manually in Supabase:

```sql
INSERT INTO profiles (id, full_name, username, email, created_at, updated_at)
VALUES (
  'user-uuid-here',
  'Test User',
  'testuser123',
  'test@example.com',
  NOW(),
  NOW()
);
```

---

## Environment Check

Make sure these are set correctly:

```bash
# .env.local
NEXT_PUBLIC_SITE_URL=https://lets-assist.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

In Supabase Dashboard (Authentication → URL Configuration):
- **Site URL**: `https://lets-assist.com`
- **Redirect URLs**: Should include `https://lets-assist.com/auth/callback`

---

## Expected Flow Diagram

```
User Signs Up
     ↓
Email Sent by Supabase
     ↓
User Clicks Link
     ↓
https://api.lets-assist.com/auth/v1/verify?token=...
     ↓ (Supabase verifies token)
     ↓
Redirect to: https://lets-assist.com/auth/callback?code=...&type=signup
     ↓ (Callback handler)
     ↓
IF no redirectAfterAuth AND (type=signup OR recent user):
     ↓
     Sign Out User
     ↓
     Redirect to: /auth/verification-success?type=signup&email=...
     ↓
     Show Success Page ✅
     ↓
     Click "Go to Login"
     ↓
     /login?verified=true&email=...
     ↓
     User Logs In
     ↓
     (Institution?) → DOB Onboarding → /home → Welcome Modal
     (Regular?) → /home → Welcome Modal
ELSE:
     ↓
     Continue to regular flow (OAuth or redirect)
```

---

## Log Examples

### ✅ Successful Email Verification

```
Auth callback params: { 
  code: 'present', 
  type: 'signup', 
  redirectAfterAuth: null 
}
Email verification check: { 
  type: 'signup',
  isEmailVerification: true,
  isRecentSignup: true,
  hasCompletedOnboarding: false,
  redirectAfterAuth: null,
  timeSinceCreation: '45s'
}
✅ Email verification detected - redirecting to success page {
  userEmail: 'test@example.com',
  isEmailVerification: true,
  isRecentSignup: true
}
Redirecting to: https://lets-assist.com/auth/verification-success?type=signup&email=test@example.com
```

### ❌ Failed Detection (Wrong Flow)

```
Auth callback params: { 
  code: 'present', 
  type: null,                    // ← Missing type!
  redirectAfterAuth: '/dashboard' // ← Has redirect
}
⚠️ Email verification NOT detected - continuing to normal flow {
  redirectAfterAuth: '/dashboard',
  isEmailVerification: false,
  isRecentSignup: true,
  hasCompletedOnboarding: false
}
```

---

## Need Help?

1. **Check the logs** - Console should tell you what's happening
2. **Check the URL** - What parameters are present?
3. **Check timing** - Is user < 5 minutes old?
4. **Check Supabase** - Is email confirmation enabled?
5. **Try manual URL** - Does `/auth/verification-success` page work?

**Still stuck?** Share the console logs and URL parameters with the team.

---

**Last Updated**: December 2024