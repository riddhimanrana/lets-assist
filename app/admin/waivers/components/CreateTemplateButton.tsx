'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { CreateGlobalTemplateDialog } from '@/components/admin/CreateGlobalTemplateDialog';

export function CreateTemplateButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Create New Template
      </Button>
      <CreateGlobalTemplateDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
