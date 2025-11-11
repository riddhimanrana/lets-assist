'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { approveParentalConsent, denyParentalConsent } from '@/app/account/parental-consent/actions';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface ConsentInfo {
  id: string;
  studentName: string;
  studentEmail: string;
  parentName: string;
  parentEmail: string;
  createdAt: string;
  expiresAt: string;
}

interface ParentalConsentApprovalFormProps {
  token: string;
  consent: ConsentInfo;
}

export default function ParentalConsentApprovalForm({ token, consent }: ParentalConsentApprovalFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [isDenied, setIsDenied] = useState(false);
  const [showDenyForm, setShowDenyForm] = useState(false);
  const [denyReason, setDenyReason] = useState('');

  // Consent checkboxes
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [agreedToDataCollection, setAgreedToDataCollection] = useState(false);
  const [agreedToModeration, setAgreedToModeration] = useState(false);
  const [confirmedParent, setConfirmedParent] = useState(false);

  const allCheckboxesChecked =
    agreedToTerms &&
    agreedToPrivacy &&
    agreedToDataCollection &&
    agreedToModeration &&
    confirmedParent;

  const handleApprove = async () => {
    if (!allCheckboxesChecked) {
      toast.error('Please agree to all statements before proceeding');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await approveParentalConsent(token);

      if (result.error) {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      setIsApproved(true);
      toast.success('Consent approved successfully!', {
        description: 'The student account has been activated.',
      });
    } catch (error) {
      toast.error('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleDeny = async () => {
    if (!denyReason.trim()) {
      toast.error('Please provide a reason for denying consent');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await denyParentalConsent(token, denyReason);

      if (result.error) {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      setIsDenied(true);
      toast.info('Consent denied', {
        description: 'The student has been notified.',
      });
    } catch (error) {
      toast.error('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  // Success state after approval
  if (isApproved) {
    return (
      <div className="p-8 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 text-center space-y-4">
        <CheckCircle2 className="h-16 w-16 text-green-600 dark:text-green-400 mx-auto" />
        <h2 className="text-2xl font-bold text-green-900 dark:text-green-100">
          Consent Approved Successfully!
        </h2>
        <p className="text-green-700 dark:text-green-300">
          Thank you for providing consent. <strong>{consent.studentName}</strong> can now fully access their account
          and start exploring volunteer opportunities on Let's Assist.
        </p>
        <div className="pt-4">
          <p className="text-sm text-green-600 dark:text-green-400">
            ✓ A confirmation email has been sent to {consent.parentEmail}
            <br />
            ✓ The student has been notified and can now log in
            <br />
            ✓ Profile settings have been set to private for safety
          </p>
        </div>
      </div>
    );
  }

  // Denied state
  if (isDenied) {
    return (
      <div className="p-8 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800 text-center space-y-4">
        <XCircle className="h-16 w-16 text-orange-600 dark:text-orange-400 mx-auto" />
        <h2 className="text-2xl font-bold text-orange-900 dark:text-orange-100">
          Consent Denied
        </h2>
        <p className="text-orange-700 dark:text-orange-300">
          You have declined to provide consent for <strong>{consent.studentName}</strong> to use Let's Assist.
          The student account will remain restricted until consent is provided.
        </p>
        <div className="pt-4">
          <p className="text-sm text-orange-600 dark:text-orange-400">
            If you change your mind or have questions, please contact us at support@letsassist.org
          </p>
        </div>
      </div>
    );
  }

  // Deny form view
  if (showDenyForm) {
    return (
      <div className="space-y-6">
        <div className="p-6 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
          <div className="flex items-start space-x-3">
            <AlertCircle className="h-6 w-6 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-orange-900 dark:text-orange-100">Deny Consent</h3>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                Before denying consent, please let us know your reason. This helps us improve our platform
                and address any concerns you may have.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="denyReason">Reason for Denial (Optional)</Label>
          <Textarea
            id="denyReason"
            placeholder="Please share your concerns or reasons for denying consent..."
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            rows={5}
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            Your feedback helps us improve safety and transparency for all users.
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setShowDenyForm(false)}
            disabled={isSubmitting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeny}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? 'Processing...' : 'Confirm Denial'}
          </Button>
        </div>
      </div>
    );
  }

  // Main approval form
  return (
    <div className="space-y-6">
      <div className="p-6 bg-card rounded-lg border space-y-4">
        <h2 className="text-xl font-semibold">Consent Confirmation</h2>
        <p className="text-sm text-muted-foreground">
          Please review and agree to the following statements:
        </p>

        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="terms"
              checked={agreedToTerms}
              onCheckedChange={(checked) => setAgreedToTerms(checked as boolean)}
              disabled={isSubmitting}
            />
            <div className="flex-1">
              <Label
                htmlFor="terms"
                className="text-sm font-normal cursor-pointer leading-relaxed"
              >
                I have read and agree to Let's Assist's{' '}
                <a
                  href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/terms`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Terms of Service
                </a>
              </Label>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="privacy"
              checked={agreedToPrivacy}
              onCheckedChange={(checked) => setAgreedToPrivacy(checked as boolean)}
              disabled={isSubmitting}
            />
            <div className="flex-1">
              <Label
                htmlFor="privacy"
                className="text-sm font-normal cursor-pointer leading-relaxed"
              >
                I have read and agree to Let's Assist's{' '}
                <a
                  href={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Privacy Policy
                </a>
              </Label>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="dataCollection"
              checked={agreedToDataCollection}
              onCheckedChange={(checked) => setAgreedToDataCollection(checked as boolean)}
              disabled={isSubmitting}
            />
            <div className="flex-1">
              <Label
                htmlFor="dataCollection"
                className="text-sm font-normal cursor-pointer leading-relaxed"
              >
                I consent to the collection, use, and disclosure of my child's personal information as described
                in the Privacy Policy, including name, email, date of birth, and volunteer activity data
              </Label>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="moderation"
              checked={agreedToModeration}
              onCheckedChange={(checked) => setAgreedToModeration(checked as boolean)}
              disabled={isSubmitting}
            />
            <div className="flex-1">
              <Label
                htmlFor="moderation"
                className="text-sm font-normal cursor-pointer leading-relaxed"
              >
                I understand that all content created by my child will be subject to AI-powered moderation and
                human review to ensure safety and compliance
              </Label>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="confirmedParent"
              checked={confirmedParent}
              onCheckedChange={(checked) => setConfirmedParent(checked as boolean)}
              disabled={isSubmitting}
            />
            <div className="flex-1">
              <Label
                htmlFor="confirmedParent"
                className="text-sm font-normal cursor-pointer leading-relaxed"
              >
                <strong>I confirm that I am the parent or legal guardian of {consent.studentName}</strong> and
                I have the authority to provide this consent on their behalf
              </Label>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => setShowDenyForm(true)}
          disabled={isSubmitting}
          className="flex-1"
        >
          <XCircle className="mr-2 h-4 w-4" />
          Deny Consent
        </Button>
        <Button
          onClick={handleApprove}
          disabled={!allCheckboxesChecked || isSubmitting}
          className="flex-1"
          size="lg"
        >
          {isSubmitting ? (
            'Processing...'
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve Consent
            </>
          )}
        </Button>
      </div>

      {!allCheckboxesChecked && (
        <p className="text-xs text-center text-muted-foreground">
          Please agree to all statements above to approve consent
        </p>
      )}
    </div>
  );
}
