'use server';

import { createClient } from '@/utils/supabase/server';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendParentalConsentRequestParams {
  studentId: string;
  studentName: string;
  studentEmail: string;
  parentEmail: string;
  parentName: string;
}

/**
 * Generate a secure token for parental consent
 */
function generateConsentToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Send parental consent request email
 */
export async function sendParentalConsentRequest({
  studentId,
  studentName,
  studentEmail,
  parentEmail,
  parentName,
}: SendParentalConsentRequestParams) {
  try {
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== studentId) {
      return { error: 'Unauthorized' };
    }

    // Verify student requires parental consent
    const { data: profile } = await supabase
      .from('profiles')
      .select('parental_consent_required, parental_consent_verified')
      .eq('id', studentId)
      .single();

    if (!profile?.parental_consent_required) {
      return { error: 'Parental consent not required for this account' };
    }

    if (profile.parental_consent_verified) {
      return { error: 'Parental consent already verified' };
    }

    // Generate token and expiration (7 days from now)
    const token = generateConsentToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Mark any existing pending requests as superseded
    await supabase
      .from('parental_consents')
      .update({ status: 'superseded' })
      .eq('student_id', studentId)
      .eq('status', 'pending');

    // Create new consent request using service role to bypass RLS
    const supabaseServiceRole = await createClient();
    const { error: insertError, data: consentData } = await supabaseServiceRole
      .from('parental_consents')
      .insert({
        student_id: studentId,
        parent_name: parentName,
        parent_email: parentEmail,
        token,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating consent request:', insertError);
      return { error: 'Failed to create consent request' };
    }

    // Generate consent URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const consentUrl = `${baseUrl}/parental-consent/${token}`;

    // Send email via Resend
    try {
      await resend.emails.send({
        from: 'Let\'s Assist <noreply@letsassist.org>',
        to: parentEmail,
        subject: `Parental Consent Request for ${studentName}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parental Consent Request</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Let's Assist</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Parental Consent Request</p>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px; margin-top: 0;">Dear ${parentName},</p>

    <p style="font-size: 16px;">
      Your child, <strong>${studentName}</strong> (${studentEmail}), has created an account on Let's Assist,
      a platform connecting students with volunteer opportunities.
    </p>

    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 14px; color: #92400e;">
        <strong>🛡️ COPPA Compliance Required</strong><br>
        Under the Children's Online Privacy Protection Act (COPPA), we need your consent before
        your child can fully access our platform.
      </p>
    </div>

    <p style="font-size: 16px;">
      <strong>What we need from you:</strong>
    </p>

    <ul style="font-size: 15px; line-height: 1.8;">
      <li>Review our <a href="${baseUrl}/privacy" style="color: #667eea; text-decoration: none;">Privacy Policy</a> and <a href="${baseUrl}/terms" style="color: #667eea; text-decoration: none;">Terms of Service</a></li>
      <li>Confirm your consent for your child to use the platform</li>
      <li>Understand the safety features we've implemented</li>
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${consentUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        Review & Provide Consent
      </a>
    </div>

    <div style="background: #e0e7ff; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 13px; color: #3730a3;">
        <strong>📧 Consent Link Details:</strong><br>
        This link is unique to your child's account and expires in 7 days.<br>
        Link: <code style="background: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">${consentUrl}</code>
      </p>
    </div>

    <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
      <strong>Questions or concerns?</strong><br>
      Contact us at <a href="mailto:support@letsassist.org" style="color: #667eea; text-decoration: none;">support@letsassist.org</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
      Let's Assist | Empowering students through volunteering<br>
      <a href="${baseUrl}" style="color: #667eea; text-decoration: none;">${baseUrl}</a>
    </p>
  </div>
</body>
</html>
        `,
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Even if email fails, we've created the consent request
      // Return success but note the email issue
      return {
        success: true,
        consentId: consentData.id,
        warning: 'Consent request created but email delivery may have failed. Please contact support if the email is not received.'
      };
    }

    return {
      success: true,
      consentId: consentData.id
    };
  } catch (error) {
    console.error('Error in sendParentalConsentRequest:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Verify parental consent token
 */
export async function verifyConsentToken(token: string) {
  try {
    const supabase = await createClient();

    const { data: consent } = await supabase
      .from('parental_consents')
      .select('*, profiles!parental_consents_student_id_fkey(full_name, email)')
      .eq('token', token)
      .single();

    if (!consent) {
      return { error: 'Invalid consent link' };
    }

    // Check if token is expired
    if (new Date(consent.expires_at) < new Date()) {
      return { error: 'This consent link has expired' };
    }

    // Check if already processed
    if (consent.status !== 'pending') {
      return {
        error: consent.status === 'approved'
          ? 'Consent has already been approved'
          : 'This consent request is no longer valid'
      };
    }

    return {
      success: true,
      consent: {
        id: consent.id,
        studentName: consent.profiles?.full_name || 'Student',
        studentEmail: consent.profiles?.email || '',
        parentName: consent.parent_name,
        parentEmail: consent.parent_email,
        createdAt: consent.created_at,
        expiresAt: consent.expires_at,
      }
    };
  } catch (error) {
    console.error('Error in verifyConsentToken:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Approve parental consent
 */
export async function approveParentalConsent(token: string, ipAddress?: string) {
  try {
    // Use service role client to bypass RLS
    const supabase = await createClient();

    // First verify the token is valid
    const verification = await verifyConsentToken(token);
    if (verification.error || !verification.consent) {
      return { error: verification.error || 'Invalid consent' };
    }

    const consent = verification.consent;

    // Update consent status to approved
    const { error: updateError } = await supabase
      .from('parental_consents')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        ip_address: ipAddress,
      })
      .eq('token', token);

    if (updateError) {
      console.error('Error updating consent:', updateError);
      return { error: 'Failed to approve consent' };
    }

    // Get the consent record to find student_id
    const { data: consentRecord } = await supabase
      .from('parental_consents')
      .select('student_id')
      .eq('token', token)
      .single();

    if (!consentRecord) {
      return { error: 'Consent record not found' };
    }

    // Update student profile to mark consent as verified
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        parental_consent_verified: true,
      })
      .eq('id', consentRecord.student_id);

    if (profileError) {
      console.error('Error updating profile:', profileError);
      return { error: 'Failed to update student profile' };
    }

    // Send confirmation email to parent
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

      await resend.emails.send({
        from: 'Let\'s Assist <noreply@letsassist.org>',
        to: consent.parentEmail,
        subject: `Consent Approved for ${consent.studentName}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Consent Approved</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">✓ Consent Approved</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <p style="font-size: 16px; margin-top: 0;">Dear ${consent.parentName},</p>

    <p style="font-size: 16px;">
      Thank you for providing consent for <strong>${consent.studentName}</strong> to use Let's Assist.
    </p>

    <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 14px; color: #065f46;">
        <strong>✓ Account Activated</strong><br>
        Your child now has full access to the platform and can start exploring volunteer opportunities.
      </p>
    </div>

    <p style="font-size: 16px;">
      <strong>Safety Features:</strong>
    </p>

    <ul style="font-size: 15px; line-height: 1.8;">
      <li>Profile set to private by default</li>
      <li>AI-powered content moderation</li>
      <li>No direct messaging between users</li>
      <li>Adult supervision at all volunteer events</li>
    </ul>

    <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
      <strong>Need to revoke consent or have questions?</strong><br>
      Contact us at <a href="mailto:support@letsassist.org" style="color: #667eea; text-decoration: none;">support@letsassist.org</a>
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
      Let's Assist | Empowering students through volunteering<br>
      <a href="${baseUrl}" style="color: #667eea; text-decoration: none;">${baseUrl}</a>
    </p>
  </div>
</body>
</html>
        `,
      });
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Consent is still approved even if email fails
    }

    return { success: true };
  } catch (error) {
    console.error('Error in approveParentalConsent:', error);
    return { error: 'An unexpected error occurred' };
  }
}

/**
 * Deny parental consent
 */
export async function denyParentalConsent(token: string, reason?: string) {
  try {
    const supabase = await createClient();

    // First verify the token is valid
    const verification = await verifyConsentToken(token);
    if (verification.error || !verification.consent) {
      return { error: verification.error || 'Invalid consent' };
    }

    // Update consent status to denied
    const { error: updateError } = await supabase
      .from('parental_consents')
      .update({
        status: 'denied',
        denied_at: new Date().toISOString(),
        denial_reason: reason,
      })
      .eq('token', token);

    if (updateError) {
      console.error('Error updating consent:', updateError);
      return { error: 'Failed to deny consent' };
    }

    return { success: true };
  } catch (error) {
    console.error('Error in denyParentalConsent:', error);
    return { error: 'An unexpected error occurred' };
  }
}
