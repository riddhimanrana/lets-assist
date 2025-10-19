
'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function EmailVerifiedModal() {
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (searchParams.get('verified') === 'true') {
      setIsOpen(true);
      setEmail(searchParams.get('email') || '');
      // Clean up the URL
      const url = new URL(window.location.href);
      url.searchParams.delete('verified');
      url.searchParams.delete('email');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Email Verified!</DialogTitle>
          <DialogDescription>
            Successfully confirmed email for {email}. Please log in to continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleClose}>Login</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
