"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface WaiverDefinitionSignerInput {
  roleKey: string;
  label: string;
  required: boolean;
  orderIndex: number;
}

interface SignerRolesEditorProps {
  signers: WaiverDefinitionSignerInput[];
  onSignersChange: (signers: WaiverDefinitionSignerInput[]) => void;
  readOnly?: boolean;
}

export function SignerRolesEditor({
  signers,
  onSignersChange,
  readOnly = false
}: SignerRolesEditorProps) {
  const [newLabel, setNewLabel] = useState("");

  const handleAddSigner = () => {
    // Generate role key from label or random
    const baseKey = newLabel
      ? newLabel.toLowerCase().replace(/[^a-z0-9]/g, "_")
      : `signer_${signers.length + 1}`;
      
    // Ensure unique key
    let roleKey = baseKey;
    let counter = 1;
    while (signers.some(s => s.roleKey === roleKey)) {
      roleKey = `${baseKey}_${counter}`;
      counter++;
    }

    const newSigner: WaiverDefinitionSignerInput = {
      roleKey,
      label: newLabel || `Signer ${signers.length + 1}`,
      required: true,
      orderIndex: signers.length,
    };

    onSignersChange([...signers, newSigner]);
    setNewLabel("");
  };

  const handleRemoveSigner = (index: number) => {
    const newSigners = signers.filter((_, i) => i !== index);
    // Reorder indices
    onSignersChange(newSigners.map((s, i) => ({ ...s, orderIndex: i })));
  };

  const handleUpdateSigner = (index: number, updates: Partial<WaiverDefinitionSignerInput>) => {
    const newSigners = [...signers];
    newSigners[index] = { ...newSigners[index], ...updates };
    onSignersChange(newSigners);
  };

  const handleMoveSigner = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === signers.length - 1) return;

    const newSigners = [...signers];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap
    [newSigners[index], newSigners[targetIndex]] = [newSigners[targetIndex], newSigners[index]];
    
    // Update order indices
    onSignersChange(newSigners.map((s, i) => ({ ...s, orderIndex: i })));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Signer Roles</h3>
        <span className="text-xs text-muted-foreground">{signers.length} roles</span>
      </div>

      <div className="space-y-2">
        {signers.map((signer, index) => (
          <Card key={signer.roleKey} className="relative overflow-hidden">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex flex-col gap-1 text-muted-foreground">
                 <Button 
                   variant="ghost" 
                   size="icon" 
                   className="h-5 w-5" 
                   disabled={index === 0 || readOnly}
                   onClick={() => handleMoveSigner(index, 'up')}
                 >
                   <ChevronUp className="h-3 w-3" />
                 </Button>
                 <Button 
                   variant="ghost" 
                   size="icon" 
                   className="h-5 w-5" 
                   disabled={index === signers.length - 1 || readOnly}
                   onClick={() => handleMoveSigner(index, 'down')}
                 >
                   <ChevronDown className="h-3 w-3" />
                 </Button>
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Label htmlFor={`label-${signer.roleKey}`} className="sr-only">Label</Label>
                    <Input
                      id={`label-${signer.roleKey}`}
                      value={signer.label}
                      onChange={(e) => handleUpdateSigner(index, { label: e.target.value })}
                      className="h-8"
                      placeholder="Role Name"
                      disabled={readOnly}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono bg-muted px-1 rounded">{signer.roleKey}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`req-${signer.roleKey}`} className="text-xs">Required</Label>
                    <Switch
                      id={`req-${signer.roleKey}`}
                      checked={signer.required}
                      onCheckedChange={(checked) => handleUpdateSigner(index, { required: checked })}
                      disabled={readOnly}
                      className="scale-75 origin-right"
                    />
                  </div>
                </div>
              </div>

                <Tooltip>
                  <TooltipTrigger>
                    <span 
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-destructive/10 text-destructive hover:text-destructive cursor-pointer"
                      onClick={() => handleRemoveSigner(index)}
                      data-disabled={signers.length <= 1 || readOnly ? "true" : undefined}
                      style={{ pointerEvents: signers.length <= 1 || readOnly ? 'none' : 'auto', opacity: signers.length <= 1 || readOnly ? 0.5 : 1 }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Remove Role</TooltipContent>
                </Tooltip>
            </CardContent>
          </Card>
        ))}
      </div>

      {!readOnly && (
        <div className="flex gap-2">
          <Input
            placeholder="New Role Name (e.g. Guardian)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSigner()}
            className="flex-1"
          />
          <Button onClick={handleAddSigner} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add Role
          </Button>
        </div>
      )}
    </div>
  );
}
