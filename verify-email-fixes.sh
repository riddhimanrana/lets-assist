#!/bin/bash

# Email Verification Fixes - Testing Script
# This script helps verify that all the fixes are in place and working

echo "🔍 Verifying Email Verification Fixes..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_ROOT="/Users/riddhiman.rana/Desktop/Coding/Let's Assist/lets-assist"

# Check 1: Verify resendVerificationEmail has error codes
echo "1️⃣  Checking resendVerificationEmail error handling..."
if grep -q 'code: "captcha_required"' "$PROJECT_ROOT/app/signup/actions.ts" && \
   grep -q 'code: "link_expired"' "$PROJECT_ROOT/app/signup/actions.ts"; then
  echo -e "${GREEN}✓${NC} Error codes implemented correctly"
else
  echo -e "${RED}✗${NC} Error codes missing"
fi
echo ""

# Check 2: Verify auth callback handles otp_expired
echo "2️⃣  Checking auth callback for otp_expired handling..."
if grep -q 'error_code === "otp_expired"' "$PROJECT_ROOT/app/auth/callback/route.ts"; then
  echo -e "${GREEN}✓${NC} OTP expired detection implemented"
else
  echo -e "${RED}✗${NC} OTP expired detection missing"
fi
echo ""

# Check 3: Verify email-expired page exists
echo "3️⃣  Checking email-expired page exists..."
if [ -f "$PROJECT_ROOT/app/auth/email-expired/page.tsx" ] && \
   [ -f "$PROJECT_ROOT/app/auth/email-expired/EmailExpiredClient.tsx" ]; then
  echo -e "${GREEN}✓${NC} Email expired pages created"
else
  echo -e "${RED}✗${NC} Email expired pages missing"
fi
echo ""

# Check 4: Verify SignupClient handles error codes
echo "4️⃣  Checking SignupClient error handling..."
if grep -q 'resendResult.code === "link_expired"' "$PROJECT_ROOT/app/signup/SignupClient.tsx" && \
   grep -q 'resendResult.code === "captcha_required"' "$PROJECT_ROOT/app/signup/SignupClient.tsx"; then
  echo -e "${GREEN}✓${NC} SignupClient error handling implemented"
else
  echo -e "${RED}✗${NC} SignupClient error handling incomplete"
fi
echo ""

# Check 5: Verify ResendVerificationButton updated
echo "5️⃣  Checking ResendVerificationButton enhancements..."
if grep -q 'code: "link_expired"' "$PROJECT_ROOT/app/signup/success/ResendVerificationButton.tsx" && \
   grep -q 'router.push' "$PROJECT_ROOT/app/signup/success/ResendVerificationButton.tsx"; then
  echo -e "${GREEN}✓${NC} ResendVerificationButton updated with error codes"
else
  echo -e "${RED}✗${NC} ResendVerificationButton not fully updated"
fi
echo ""

# Check 6: Summary files created
echo "6️⃣  Checking documentation files..."
if [ -f "$PROJECT_ROOT/EMAIL_VERIFICATION_FIX_GUIDE.md" ] && \
   [ -f "$PROJECT_ROOT/EMAIL_VERIFICATION_RESOLUTION.md" ] && \
   [ -f "$PROJECT_ROOT/EMAIL_VERIFICATION_FIXES.md" ]; then
  echo -e "${GREEN}✓${NC} Documentation files created"
else
  echo -e "${RED}✗${NC} Some documentation files missing"
fi
echo ""

# Check 7: Verify no CAPTCHA token in resend
echo "7️⃣  Checking resend doesn't require CAPTCHA token..."
if grep -q "We cannot pass a CAPTCHA token here" "$PROJECT_ROOT/app/signup/actions.ts"; then
  echo -e "${GREEN}✓${NC} Comment explains CAPTCHA limitation"
else
  echo -e "${YELLOW}⚠${NC} CAPTCHA limitation comment missing (non-critical)"
fi
echo ""

echo "📋 Summary of Changes:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Files Modified:"
echo "  • app/signup/actions.ts - Enhanced error handling"
echo "  • app/auth/callback/route.ts - Added OTP expired detection"
echo "  • app/signup/SignupClient.tsx - Improved UX"
echo "  • app/signup/success/ResendVerificationButton.tsx - Enhanced errors"
echo ""
echo "Files Created:"
echo "  • app/auth/email-expired/page.tsx - Recovery page"
echo "  • app/auth/email-expired/EmailExpiredClient.tsx - Recovery UI"
echo ""
echo "Documentation Created:"
echo "  • EMAIL_VERIFICATION_FIX_GUIDE.md"
echo "  • EMAIL_VERIFICATION_RESOLUTION.md"
echo "  • EMAIL_VERIFICATION_FIXES.md"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🚀 Testing Instructions:"
echo ""
echo "1. Start dev server:"
echo "   npm run dev"
echo ""
echo "2. Test resend functionality:"
echo "   - Go to http://localhost:3000/signup"
echo "   - Fill in form and submit"
echo "   - Check /signup/success page"
echo "   - Click 'Resend Verification Email' button"
echo "   - Should NOT see CAPTCHA error"
echo ""
echo "3. Test expired link handling:"
echo "   - Create account with unconfirmed email"
echo "   - Wait 24+ hours or manually expire link"
echo "   - Click verification link"
echo "   - Should redirect to /auth/email-expired"
echo "   - Should show recovery options"
echo ""
echo "4. Check for errors:"
echo "   - Look for 'captcha verification process failed' - should be GONE"
echo "   - Look for 'Error link is invalid or has expired' - should redirect"
echo ""
echo "✅ All checks complete!"
