# Email Verification Setup Guide

## Overview

This document explains how the email verification flow works in Let's Assist and how to configure Supabase to use the correct email templates and redirect URLs.

---

## 📧 Email Verification Flow

### Current Flow

1. **User signs up** → `app/signup/actions.ts`
2. **Supabase sends verification email** → User's inbox
3. **User clicks verification link** → Redirects to `/auth/callback?code=...&type=signup`
4. **Callback processes verification** → `app/auth/callback/route.ts`
5. **User is redirected to success page** → `/auth/verification-success?type=signup&email=...`
6. **Success page shows** → "Email Verified Successfully! Please log in."
7. **User clicks "Go to Login"** → `/login?verified=true&email=...`

---

## 🔧 Supabase Configuration

### Email Template Settings

To ensure the verification emails use your app URL instead of Supabase's API URL, you need to configure the email templates in Supabase Dashboard.

#### Steps:

1. **Go to Supabase Dashboard**
   - Navigate to: `Authentication` → `Email Templates`

2. **Update "Confirm signup" Template**
   
   Replace the `{{ .ConfirmationURL }}` with your app's callback URL:

   ```html
   <h2>Confirm your signup</h2>

   <p>Follow this link to confirm your email:</p>
   <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a></p>

   <p>Or copy and paste this URL into your browser:</p>
   <p>{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup</p>
   ```

3. **Set Site URL in Supabase**
   
   Go to `Authentication` → `URL Configuration`:
   
   - **Site URL**: `https://lets-assist.com` (or your production URL)
   - **Redirect URLs**: Add the following:
     - `https://lets-assist.com/auth/callback`
     - `https://lets-assist.com/auth/verification-success`
     - `http://localhost:3000/auth/callback` (for development)
     - `http://localhost:3000/auth/verification-success` (for development)

4. **Disable Email Confirmation** (Optional for development)
   
   Go to `Authentication` → `Providers` → `Email`:
   - Toggle "Enable email confirmations" ON for production
   - Toggle OFF for development (skip email verification during testing)

---

## 🔑 Environment Variables

Make sure these are set in your `.env.local`:

```bash
# Production
NEXT_PUBLIC_SITE_URL=https://lets-assist.com
NEXT_PUBLIC_APP_URL=https://lets-assist.com

# Development
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## 🧪 Testing the Flow

### Manual Testing

1. **Sign up with a new email**
   ```
   Navigate to: /signup
   Fill in: name, email, password
   Submit form
   ```

2. **Check email inbox**
   - You should receive: "Confirm your signup" email
   - Email should come from: `no-reply@mail.app.supabase.co` (or your custom domain)
   - Link should point to: `https://lets-assist.com/auth/callback?token_hash=...&type=signup`

3. **Click verification link**
   - Should redirect to: `/auth/verification-success?type=signup&email=user@example.com`
   - Should see: ✅ "Email Verified Successfully!"
   - Message: "Your account is now active. Please log in..."

4. **Click "Go to Login"**
   - Should redirect to: `/login?verified=true&email=user@example.com`
   - Email field should be pre-filled
   - Can now log in successfully

### What to Check

✅ **Email Link Format**:
```
https://lets-assist.com/auth/callback?token_hash=...&type=signup
NOT: https://api.lets-assist.com/auth/v1/verify?token=...
```

✅ **Success Page Shows**:
- Green checkmark icon
- "Email Verified Successfully!" heading
- User's email address
- "Go to Login" button

✅ **Login Pre-filled**:
- Email field should have user's email
- "verified=true" parameter in URL
- Optional: Show a "Email verified! Please log in" toast

---

## 🐛 Troubleshooting

### Issue: Email links go to Supabase API URL

**Problem**: Links look like `https://api.lets-assist.com/auth/v1/verify?token=...`

**Solution**:
1. Update Supabase email template to use `{{ .SiteURL }}/auth/callback`
2. Set Site URL in Supabase dashboard to your app URL
3. Add your app callback URL to redirect URLs list

### Issue: Verification page doesn't show

**Problem**: After clicking email link, redirects to home instead of success page

**Solution**:
1. Check `app/auth/callback/route.ts` for proper `type=signup` detection
2. Ensure `isEmailVerification` condition is working
3. Add console.log to debug:
   ```typescript
   console.log('Type:', type, 'isEmailVerification:', isEmailVerification);
   ```

### Issue: "Invalid or expired link"

**Problem**: Token has expired or already been used

**Solution**:
- Email verification links expire after 24 hours
- Request a new verification email via "Resend verification email" button
- Or sign up again with the same email (will trigger resend)

### Issue: Modal appears during verification

**Problem**: Welcome onboarding modal shows on verification success page

**Solution**:
- Check `GlobalNotificationProvider.tsx`
- Ensure `/auth/verification-success` is in suppressed routes list
- Or mark as public route in middleware

---

## 📝 Code Reference

### Key Files

1. **Signup Action** (`app/signup/actions.ts`)
   ```typescript
   export async function signup(formData: FormData) {
     // ...
     const signUpOptions: any = {
       email: validatedFields.data.email,
       password: validatedFields.data.password,
       options: {
         data: metadata,
         emailRedirectTo: `${origin}/auth/callback`, // ← Important!
       },
     };
     // ...
   }
   ```

2. **Callback Handler** (`app/auth/callback/route.ts`)
   ```typescript
   export async function GET(request: Request) {
     const type = searchParams.get("type");
     const isEmailVerification = type === "signup"; // ← Detects signup verification
     
     if (isEmailVerification || (isRecentSignup && !hasCompletedOnboarding)) {
       await supabase.auth.signOut(); // Sign out to force fresh login
       return NextResponse.redirect(`${origin}/auth/verification-success`);
     }
   }
   ```

3. **Success Page** (`app/auth/verification-success/page.tsx`)
   ```typescript
   if (type === "signup") {
     title = "Email Verified Successfully!";
     buttonText = "Go to Login";
     buttonLink = `/login?verified=true&email=${email}`;
   }
   ```

---

## 🚀 Production Checklist

Before deploying to production:

- [ ] Update Supabase Site URL to production domain
- [ ] Update email templates to use `{{ .SiteURL }}`
- [ ] Add all callback URLs to redirect URLs list
- [ ] Set `NEXT_PUBLIC_SITE_URL` to production URL
- [ ] Test email verification flow end-to-end
- [ ] Enable email confirmations in Supabase
- [ ] Configure custom SMTP (optional, recommended)
- [ ] Set up custom email domain (optional)
- [ ] Test on multiple email providers (Gmail, Outlook, etc.)
- [ ] Check spam folder deliverability

---

## 🎨 Customization

### Custom Email Template

You can fully customize the email template in Supabase:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background-color: #f9fafb;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      padding: 40px;
    }
    .button {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Welcome to Let's Assist! 🎉</h1>
    <p>Hi there,</p>
    <p>Thank you for signing up! Please confirm your email address to get started.</p>
    <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup" class="button">
      Verify Email Address
    </a>
    <p>Or copy and paste this link:</p>
    <p style="color: #6b7280; word-break: break-all;">
      {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup
    </p>
    <hr>
    <p style="color: #9ca3af; font-size: 12px;">
      This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
```

---

## 📚 Resources

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Email Templates Guide](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Next.js App Router Auth](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [PKCE Flow](https://supabase.com/docs/guides/auth/server-side/pkce-flow)

---

**Last Updated**: December 2024  
**Maintained By**: Engineering Team