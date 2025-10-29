'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { sendParentalConsentRequest } from './actions';
import { Mail, Send } from 'lucide-react';

interface ParentalConsentRequestFormProps {
  studentId: string;
  studentName: string;
  studentEmail: string;
  isResend?: boolean;
}

export default function ParentalConsentRequestForm({
  studentId,
  studentName,
  studentEmail,
  isResend = false,
}: ParentalConsentRequestFormProps) {
  const router = useRouter();
  const [parentEmail, setParentEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!parentEmail || !parentName) {
      toast.error('Please fill in all fields');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(parentEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    // Prevent using the same email as student
    if (parentEmail.toLowerCase() === studentEmail.toLowerCase()) {
      toast.error('Parent email cannot be the same as student email');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await sendParentalConsentRequest({
        studentId,
        studentName,
        studentEmail,
        parentEmail,
        parentName,
      });

      if (result.error) {
        toast.error(result.error);
        setIsSubmitting(false);
        return;
      }

      toast.success('Consent request sent!', {
        description: `An email has been sent to ${parentEmail}`,
      });

      // Refresh the page to show the "request sent" state
      router.refresh();
    } catch (error) {
      toast.error('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="p-6 bg-card rounded-lg border space-y-4">
        <div className="flex items-center space-x-2 text-sm font-medium">
          <Mail className="h-4 w-4" />
          <span>Parent/Guardian Information</span>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="parentName">Parent/Guardian Name *</Label>
            <Input
              id="parentName"
              type="text"
              placeholder="Enter parent's full name"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              disabled={isSubmitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              This should be the name of your parent or legal guardian
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="parentEmail">Parent/Guardian Email *</Label>
            <Input
              id="parentEmail"
              type="email"
              placeholder="parent@example.com"
              value={parentEmail}
              onChange={(e) => setParentEmail(e.target.value)}
              disabled={isSubmitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              We'll send a consent link to this email address
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 bg-muted/50 rounded-lg border border-muted">
        <p className="text-xs text-muted-foreground">
          <strong>What happens next?</strong>
        </p>
        <ol className="text-xs text-muted-foreground mt-2 space-y-1 list-decimal list-inside">
          <li>Your parent/guardian will receive an email with a secure consent link</li>
          <li>They'll review your account information and the platform's policies</li>
          <li>Once they approve, you'll gain full access to your account</li>
        </ol>
      </div>

      <Button
        type="submit"
        disabled={isSubmitting || !parentEmail || !parentName}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          'Sending...'
        ) : (
          <>
            <Send className="mr-2 h-4 w-4" />
            {isResend ? 'Send New Request' : 'Send Consent Request'}
          </>
        )}
      </Button>
    </form>
  );
}
