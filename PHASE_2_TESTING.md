# Phase 2 Testing Checklist

## Overview
This document provides a comprehensive testing checklist for Phase 2 CIPA compliance features including DOB onboarding, parental consent, and access control.

---

## 🧪 Test Environments

### Environment Setup
- [ ] Local development environment (localhost:3000)
- [ ] Staging environment (if available)
- [ ] Production environment (final verification)

### Required Test Data
- [ ] Test institution domain added to `educational_institutions` table
- [ ] Test student emails with institution domain
- [ ] Test parent email addresses
- [ ] Various date of birth test cases (under 13, 13-17, 18+)

---

## 1️⃣ Signup Flow Tests

### TC-1.1: Regular User Signup (Non-Institution)
**Expected**: No DOB collection, immediate access

- [ ] Sign up with personal email (gmail.com, yahoo.com, etc.)
- [ ] Verify email via link
- [ ] Redirected to dashboard
- [ ] No DOB onboarding prompt
- [ ] No parental consent required
- [ ] Profile visibility set to "public" by default

**Pass Criteria**: User has immediate full access without DOB or consent requirements

---

### TC-1.2: Institution User Signup
**Expected**: DOB onboarding after verification

- [ ] Sign up with institution email (@school.edu)
- [ ] Verify email via link
- [ ] Log in successfully
- [ ] OAuth callback detects institution domain
- [ ] Automatically redirected to `/auth/dob-onboarding`
- [ ] Cannot access dashboard without completing DOB

**Pass Criteria**: User is forced to complete DOB onboarding before accessing platform

---

## 2️⃣ DOB Onboarding Tests

### TC-2.1: DOB Onboarding Page - Institution User
**Expected**: Calendar picker with validation

- [ ] Page shows institution detection banner
- [ ] Calendar picker is visible and functional
- [ ] Can select dates from dropdown (year, month, day)
- [ ] Cannot select future dates
- [ ] Cannot select dates before 1900
- [ ] Form has "Continue" button
- [ ] Shows COPPA compliance message

**Pass Criteria**: UI is functional and validates date selections

---

### TC-2.2: DOB Submission - Under 13 User
**Expected**: Profile updated, redirected to parental consent

**Test Data**: DOB = 11 years old

- [ ] Select DOB making user under 13
- [ ] Click "Continue"
- [ ] Server action processes DOB
- [ ] Profile updated with:
  - `date_of_birth`: Selected date
  - `age_verified_at`: Current timestamp
  - `profile_visibility`: "private"
  - `parental_consent_required`: true
  - `parental_consent_verified`: false
- [ ] Toast shows "Parental consent required"
- [ ] Redirected to `/account/parental-consent`

**Pass Criteria**: Profile correctly flagged for parental consent

---

### TC-2.3: DOB Submission - Age 13-17 User
**Expected**: Profile updated, access granted

**Test Data**: DOB = 15 years old

- [ ] Select DOB making user 13-17
- [ ] Click "Continue"
- [ ] Profile updated with:
  - `date_of_birth`: Selected date
  - `age_verified_at`: Current timestamp
  - `profile_visibility`: "private"
  - `parental_consent_required`: false
  - `parental_consent_verified`: true
- [ ] Toast shows success
- [ ] Redirected to `/dashboard`
- [ ] Full platform access granted

**Pass Criteria**: User can access platform immediately, profile is private by default

---

### TC-2.4: DOB Submission - Age 18+ User
**Expected**: Profile updated with public visibility

**Test Data**: DOB = 25 years old

- [ ] Select DOB making user 18+
- [ ] Click "Continue"
- [ ] Profile updated with:
  - `profile_visibility`: "public"
  - `parental_consent_required`: false
  - `parental_consent_verified`: true
- [ ] Redirected to `/dashboard`
- [ ] Full platform access granted

**Pass Criteria**: Profile is public by default for adults

---

### TC-2.5: DOB Validation Errors
**Expected**: Proper error handling

- [ ] Submitting without selecting date shows error
- [ ] Selecting invalid date (age > 120) shows error
- [ ] Selecting invalid date (age < 5) shows error
- [ ] Error messages are user-friendly

**Pass Criteria**: All validation rules work correctly

---

## 3️⃣ Parental Consent Request Tests

### TC-3.1: Consent Request Page - First Visit
**Expected**: Form to send consent request

- [ ] Page shows "Parental Consent Required" heading
- [ ] COPPA compliance information displayed
- [ ] Form has fields:
  - Parent/Guardian Name
  - Parent/Guardian Email
- [ ] Form validates email format
- [ ] Form prevents using same email as student
- [ ] "What happens next" section visible

**Pass Criteria**: UI is clear and form is functional

---

### TC-3.2: Send Consent Request
**Expected**: Email sent, database updated

**Test Data**: 
- Student: john.doe@school.edu (age 11)
- Parent: parent@example.com

- [ ] Fill in parent name: "Jane Doe"
- [ ] Fill in parent email: "parent@example.com"
- [ ] Click "Send Consent Request"
- [ ] Server action creates record in `parental_consents`:
  - `student_id`: Student's user ID
  - `parent_name`: "Jane Doe"
  - `parent_email`: "parent@example.com"
  - `token`: Random 64-character hex string
  - `status`: "pending"
  - `expires_at`: 7 days from now
- [ ] Email sent to parent@example.com
- [ ] Email contains:
  - Student name and email
  - Consent link with token
  - Privacy policy link
  - Terms of service link
  - Safety information
- [ ] Toast shows "Consent request sent!"
- [ ] Page refreshes to show "Consent Request Sent" state

**Pass Criteria**: Database updated and email delivered

---

### TC-3.3: Email Validation
**Expected**: Prevents invalid submissions

- [ ] Empty parent name shows error
- [ ] Empty parent email shows error
- [ ] Invalid email format shows error
- [ ] Parent email same as student email shows error
- [ ] Error messages are clear

**Pass Criteria**: All validation rules enforced

---

### TC-3.4: Pending Consent Display
**Expected**: Shows existing request details

- [ ] After sending request, page shows blue info box
- [ ] Displays parent email where request was sent
- [ ] Shows timestamp of when request was sent
- [ ] "Send New Request" button visible
- [ ] Can send request to different email

**Pass Criteria**: User can see request status

---

### TC-3.5: Multiple Consent Requests
**Expected**: Old requests superseded

- [ ] Send consent request to parent1@example.com
- [ ] Send another request to parent2@example.com
- [ ] First request status changes to "superseded"
- [ ] Second request status is "pending"
- [ ] Only latest request is valid

**Pass Criteria**: Only one active request per student

---

## 4️⃣ Parental Consent Approval Tests

### TC-4.1: Valid Consent Link
**Expected**: Parent sees consent form

**Test Data**: Valid token from recent request

- [ ] Parent opens email
- [ ] Clicks consent link
- [ ] Redirected to `/parental-consent/[token]`
- [ ] Page loads successfully
- [ ] Student information displayed:
  - Student name
  - Student email
- [ ] Parent information displayed:
  - Parent name
  - Parent email
- [ ] Request metadata shown:
  - Request date/time
  - Expiration date/time
- [ ] "Why is consent required?" section visible
- [ ] Safety features listed
- [ ] Privacy policy and Terms links present
- [ ] Consent checkboxes visible
- [ ] "Approve Consent" and "Deny Consent" buttons visible

**Pass Criteria**: All information displays correctly

---

### TC-4.2: Consent Token Validation
**Expected**: Invalid tokens rejected

**Test Invalid Tokens**:
- [ ] Random/fake token → "Invalid consent link"
- [ ] Expired token (> 7 days old) → "Link has expired"
- [ ] Already approved token → "Already been approved"
- [ ] Superseded token → "No longer valid"

**Pass Criteria**: Appropriate error message for each case

---

### TC-4.3: Approve Consent - Success Flow
**Expected**: Student account activated

**Steps**:
- [ ] Open valid consent link
- [ ] Check all 5 consent checkboxes:
  1. Agree to Terms of Service
  2. Agree to Privacy Policy
  3. Consent to data collection
  4. Understand moderation policy
  5. Confirm parent/guardian status
- [ ] Click "Approve Consent"
- [ ] Loading state shows "Processing..."
- [ ] Database updates:
  - `parental_consents.status`: "approved"
  - `parental_consents.approved_at`: Current timestamp
  - `profiles.parental_consent_verified`: true
- [ ] Success screen shows:
  - Green checkmark
  - "Consent Approved Successfully!"
  - Confirmation details
- [ ] Confirmation email sent to parent
- [ ] Student can now log in and access platform

**Pass Criteria**: Full approval flow works end-to-end

---

### TC-4.4: Approve Consent - Validation
**Expected**: Cannot approve without all checkboxes

- [ ] Button disabled if checkboxes not checked
- [ ] Clicking disabled button shows tooltip/error
- [ ] Must check all 5 checkboxes to enable
- [ ] Button enables once all checked

**Pass Criteria**: Form validation prevents incomplete submissions

---

### TC-4.5: Deny Consent Flow
**Expected**: Request denied, student notified

**Steps**:
- [ ] Open valid consent link
- [ ] Click "Deny Consent" button
- [ ] Deny form appears with:
  - Warning message
  - Reason textarea (optional)
- [ ] Enter denial reason (optional)
- [ ] Click "Confirm Denial"
- [ ] Database updates:
  - `parental_consents.status`: "denied"
  - `parental_consents.denied_at`: Current timestamp
  - `parental_consents.denial_reason`: Reason text
- [ ] Denial confirmation screen shows
- [ ] Student profile unchanged (still restricted)

**Pass Criteria**: Denial is recorded correctly

---

### TC-4.6: Privacy Policy & Terms Links
**Expected**: Links open correctly

- [ ] Click "Read Privacy Policy" → Opens /privacy
- [ ] Click "Read Terms of Service" → Opens /terms
- [ ] Links open in new tab
- [ ] Parent can return to consent page

**Pass Criteria**: External links work correctly

---

## 5️⃣ Access Control & Middleware Tests

### TC-5.1: Middleware - Unauthenticated Users
**Expected**: Redirect to login

**Test URLs**:
- [ ] `/dashboard` → Redirects to `/login?redirectAfterAuth=/dashboard`
- [ ] `/projects` → Redirects to `/login?redirectAfterAuth=/projects`
- [ ] `/account/profile` → Redirects to `/login`

**Pass Criteria**: All protected routes redirect to login

---

### TC-5.2: Middleware - Public Routes
**Expected**: No authentication required

**Test URLs**:
- [ ] `/` → Accessible
- [ ] `/login` → Accessible
- [ ] `/signup` → Accessible
- [ ] `/privacy` → Accessible
- [ ] `/terms` → Accessible
- [ ] `/contact` → Accessible
- [ ] `/parental-consent/[token]` → Accessible

**Pass Criteria**: Public routes load without login

---

### TC-5.3: Middleware - Institution User Without DOB
**Expected**: Redirect to DOB onboarding

**Test User**: Institution email, no DOB

- [ ] Log in successfully
- [ ] Attempt to visit `/dashboard`
- [ ] Middleware detects missing DOB
- [ ] Redirected to `/auth/dob-onboarding`
- [ ] Cannot access other routes until DOB submitted

**Pass Criteria**: User locked to DOB onboarding

---

### TC-5.4: Middleware - Under 13 Without Consent
**Expected**: Redirect to parental consent

**Test User**: Age 11, no parental consent

- [ ] Complete DOB onboarding
- [ ] Attempt to visit `/dashboard`
- [ ] Middleware detects missing consent
- [ ] Redirected to `/account/parental-consent`
- [ ] Cannot access platform routes

**Pass Criteria**: User locked to consent request page

---

### TC-5.5: Middleware - Under 13 With Consent
**Expected**: Full access granted

**Test User**: Age 11, consent verified

- [ ] Parent has approved consent
- [ ] Log in successfully
- [ ] Can access `/dashboard`
- [ ] Can access `/projects`
- [ ] Can browse volunteer opportunities
- [ ] Profile visibility is "private"

**Pass Criteria**: Full platform access with private profile

---

### TC-5.6: Restricted Access Page
**Expected**: Informative page for restricted users

- [ ] Under-13 user without consent visits restricted route
- [ ] Shows `/restricted` page with:
  - Shield icon with lock
  - "Account Restricted" heading
  - COPPA explanation
  - 3-step process explanation
  - Link to send consent request
- [ ] Click "Send Consent Request" → Goes to `/account/parental-consent`

**Pass Criteria**: Friendly UX explaining restrictions

---

## 6️⃣ Profile Visibility Tests

### TC-6.1: Under 13 - Private Profile (Immutable)
**Expected**: Profile forced to private

**Test User**: Age 11, consent approved

- [ ] Profile visibility is "private"
- [ ] Cannot change visibility setting
- [ ] Profile settings page shows lock/disabled state
- [ ] Tooltip explains "Under 13 accounts must have private profiles"

**Pass Criteria**: Under 13 users cannot make profile public

---

### TC-6.2: Age 13-17 - Configurable Privacy
**Expected**: Can toggle public/private

**Test User**: Age 15

- [ ] Profile visibility defaults to "private"
- [ ] Can change to "public" in settings
- [ ] Can change back to "private"
- [ ] Changes saved successfully

**Pass Criteria**: Teens can control visibility

---

### TC-6.3: Age 18+ - Public by Default
**Expected**: Default public, configurable

**Test User**: Age 25

- [ ] Profile visibility defaults to "public"
- [ ] Can change to "private" in settings
- [ ] Can change back to "public"

**Pass Criteria**: Adults have full control

---

## 7️⃣ Email System Tests

### TC-7.1: Consent Request Email
**Expected**: Professional, branded email

**Verify Email Contains**:
- [ ] Let's Assist branding/logo
- [ ] Gradient header with platform name
- [ ] Student name and email clearly displayed
- [ ] Parent name personalized in greeting
- [ ] COPPA compliance explanation
- [ ] Safety features listed
- [ ] Prominent "Review & Provide Consent" button
- [ ] Consent link (with token) displayed
- [ ] Link expiration notice (7 days)
- [ ] Privacy Policy link
- [ ] Terms of Service link
- [ ] Support email (support@letsassist.org)
- [ ] Footer with branding

**Pass Criteria**: Email is professional and complete

---

### TC-7.2: Consent Approval Confirmation Email
**Expected**: Confirmation sent to parent

**Verify Email Contains**:
- [ ] Green success header
- [ ] "Consent Approved" heading
- [ ] Student name
- [ ] Account activation confirmation
- [ ] Safety features reminder
- [ ] How to revoke consent
- [ ] Support contact information

**Pass Criteria**: Parent receives confirmation

---

### TC-7.3: Email Deliverability
**Expected**: Emails reach inbox

- [ ] Consent request email delivered
- [ ] Not flagged as spam
- [ ] Links in email are clickable
- [ ] Images load correctly (if any)
- [ ] Mobile responsive design

**Pass Criteria**: Emails reliably delivered

---

## 8️⃣ Security Tests

### TC-8.1: Token Security
**Expected**: Tokens are cryptographically secure

- [ ] Tokens are 64 characters long (32-byte hex)
- [ ] Tokens are unique for each request
- [ ] Tokens cannot be guessed
- [ ] Expired tokens are rejected
- [ ] Used tokens cannot be reused

**Pass Criteria**: Token system is secure

---

### TC-8.2: SQL Injection Protection
**Expected**: No SQL injection vulnerabilities

**Test Inputs**:
- [ ] Parent name: `'; DROP TABLE users; --`
- [ ] Parent email: `admin' OR '1'='1`
- [ ] All inputs sanitized
- [ ] No database errors

**Pass Criteria**: Inputs properly escaped

---

### TC-8.3: XSS Protection
**Expected**: No cross-site scripting vulnerabilities

**Test Inputs**:
- [ ] Parent name: `<script>alert('XSS')</script>`
- [ ] Denial reason: `<img src=x onerror=alert(1)>`
- [ ] All outputs escaped
- [ ] No scripts execute

**Pass Criteria**: Content properly sanitized

---

### TC-8.4: CSRF Protection
**Expected**: Server actions protected

- [ ] Server actions require authentication
- [ ] Cannot submit consent from different origin
- [ ] Next.js CSRF protection active

**Pass Criteria**: Actions cannot be forged

---

## 9️⃣ Edge Cases & Error Handling

### TC-9.1: Network Failures
**Expected**: Graceful error handling

- [ ] Network fails during DOB submission → Error message shown
- [ ] Network fails during consent request → Retry option
- [ ] Email service down → Warning message, request still saved
- [ ] Loading states shown during async operations

**Pass Criteria**: Errors handled gracefully

---

### TC-9.2: Concurrent Consent Requests
**Expected**: Last request wins

- [ ] Student sends consent to parent1@example.com
- [ ] Immediately sends another to parent2@example.com
- [ ] First request marked as "superseded"
- [ ] Second request is active

**Pass Criteria**: No race conditions

---

### TC-9.3: Parent Changes Mind
**Expected**: Can approve after denial

- [ ] Parent denies consent
- [ ] Student sends new request
- [ ] Parent approves new request
- [ ] Account activated successfully

**Pass Criteria**: Process is repeatable

---

### TC-9.4: Student Turns 13
**Expected**: Manual process (future enhancement)

**Current Behavior**:
- [ ] Under-13 user with consent approved
- [ ] Turns 13 (birthday passes)
- [ ] Age calculation updates automatically
- [ ] Can now change profile visibility
- [ ] Parental consent remains in database

**Note**: This is a manual check for now. Future enhancement could automate.

**Pass Criteria**: System respects current age

---

## 🔟 Integration Tests

### TC-10.1: Full Under-13 Journey
**Expected**: Complete end-to-end flow

**Steps**:
1. [ ] Sign up with institution email
2. [ ] Verify email
3. [ ] Complete DOB onboarding (age 11)
4. [ ] Redirected to consent request
5. [ ] Send consent to parent
6. [ ] Parent receives email
7. [ ] Parent approves consent
8. [ ] Student logs in
9. [ ] Dashboard accessible
10. [ ] Can browse projects
11. [ ] Can apply for opportunities
12. [ ] Profile is private and locked

**Pass Criteria**: Entire flow works seamlessly

---

### TC-10.2: Full Teen Journey (13-17)
**Expected**: No consent needed

**Steps**:
1. [ ] Sign up with institution email
2. [ ] Verify email
3. [ ] Complete DOB onboarding (age 15)
4. [ ] Immediate dashboard access
5. [ ] Profile defaults to private
6. [ ] Can change to public
7. [ ] Full platform features available

**Pass Criteria**: Smooth onboarding

---

### TC-10.3: Regular User Journey
**Expected**: No restrictions

**Steps**:
1. [ ] Sign up with personal email
2. [ ] Verify email
3. [ ] Immediate access
4. [ ] No DOB required
5. [ ] No consent required
6. [ ] Profile public by default

**Pass Criteria**: Zero friction for regular users

---

## 📊 Performance Tests

### TC-11.1: DOB Onboarding Performance
**Expected**: Fast page load and submission

- [ ] Page loads in < 2 seconds
- [ ] DOB submission completes in < 1 second
- [ ] No UI freezing during submission

**Pass Criteria**: Smooth user experience

---

### TC-11.2: Consent Approval Performance
**Expected**: Fast database updates

- [ ] Token verification < 500ms
- [ ] Approval submission < 1 second
- [ ] Email sends asynchronously (doesn't block)

**Pass Criteria**: Quick response times

---

### TC-11.3: Middleware Performance
**Expected**: Minimal overhead

- [ ] Route protection check < 100ms
- [ ] No noticeable delay on page loads
- [ ] Database queries optimized

**Pass Criteria**: Middleware doesn't slow down app

---

## ✅ Browser Compatibility

### TC-12.1: Desktop Browsers
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

**Pass Criteria**: All features work in major browsers

---

### TC-12.2: Mobile Browsers
- [ ] iOS Safari
- [ ] Chrome Mobile (Android)
- [ ] Firefox Mobile

**Pass Criteria**: Mobile-responsive and functional

---

### TC-12.3: Calendar Picker Compatibility
- [ ] Calendar opens correctly on all browsers
- [ ] Date selection works on mobile
- [ ] Dropdown year/month selectors functional

**Pass Criteria**: Calendar works everywhere

---

## 🎨 Accessibility Tests

### TC-13.1: Keyboard Navigation
- [ ] Can tab through all form fields
- [ ] Can submit forms with Enter key
- [ ] Can close modals with Escape
- [ ] Focus indicators visible

**Pass Criteria**: Fully keyboard accessible

---

### TC-13.2: Screen Reader Compatibility
- [ ] Form labels read correctly
- [ ] Error messages announced
- [ ] Success messages announced
- [ ] Links have descriptive text

**Pass Criteria**: WCAG 2.1 AA compliance

---

### TC-13.3: Color Contrast
- [ ] Text meets contrast requirements
- [ ] Buttons are clearly visible
- [ ] Error states are distinguishable

**Pass Criteria**: Accessible to color-blind users

---

## 📝 Documentation Tests

### TC-14.1: Code Documentation
- [ ] All functions have JSDoc comments
- [ ] Server actions documented
- [ ] Complex logic explained
- [ ] Type definitions accurate

**Pass Criteria**: Code is well-documented

---

### TC-14.2: User-Facing Documentation
- [ ] Help center has COPPA/CIPA info
- [ ] Privacy policy updated
- [ ] Terms of service updated
- [ ] FAQ addresses consent flow

**Pass Criteria**: Users have resources

---

## 🚀 Deployment Checklist

### Pre-Deployment
- [ ] All tests passing locally
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Resend API key set
- [ ] Test emails working

### Post-Deployment
- [ ] Smoke test on production
- [ ] Monitor error logs
- [ ] Test with real institution domain
- [ ] Verify emails delivering
- [ ] Check middleware performance

---

## 📈 Success Metrics

### Functional Metrics
- [ ] 100% of tests passing
- [ ] Zero critical bugs
- [ ] All user journeys complete

### Performance Metrics
- [ ] Page load < 3s
- [ ] API responses < 1s
- [ ] Email delivery > 95%

### User Experience Metrics
- [ ] Clear error messages
- [ ] Intuitive navigation
- [ ] Minimal friction

---

## 🐛 Known Issues & Limitations

### Current Limitations:
1. **Manual Age Updates**: System doesn't automatically update when user turns 13
2. **Email Dependencies**: Requires Resend API to be functional
3. **Single Parent Email**: Only one parent can provide consent (no multi-guardian support yet)

### Future Enhancements:
1. Automated age milestone notifications
2. SMS consent option
3. Multi-guardian approval
4. Consent revocation UI for parents

---

## 📞 Support Contacts

- **Technical Issues**: engineering@letsassist.org
- **COPPA Compliance**: compliance@letsassist.org
- **General Support**: support@letsassist.org

---

**Testing Status**: 🔄 In Progress  
**Last Updated**: December 2024  
**Next Review**: Before Phase 3 Implementation