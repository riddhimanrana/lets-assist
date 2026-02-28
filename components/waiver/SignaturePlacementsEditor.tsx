"use client";

import { CustomPlacement } from "./PdfViewerWithOverlay";
import { WaiverDefinitionSignerInput } from "./SignerRolesEditor";
import { WaiverFieldType } from "@/types/waiver-definitions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const CUSTOM_FIELD_TYPE_OPTIONS: Array<{ value: WaiverFieldType; label: string }> = [
  { value: 'signature', label: 'Signature' },
  { value: 'initial', label: 'Initials' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'address', label: 'Address' },
  { value: 'text', label: 'Text' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'radio', label: 'Radio' },
  { value: 'dropdown', label: 'Dropdown' },
];

function isCustomFieldTypeOption(value: string): value is WaiverFieldType {
  return CUSTOM_FIELD_TYPE_OPTIONS.some((option) => option.value === value);
}

interface SignaturePlacementsEditorProps {
  placements: CustomPlacement[];
  signers: WaiverDefinitionSignerInput[];
  onPlacementsChange: (placements: CustomPlacement[]) => void;
  onAddPlacement: () => void;
  selectedPlacementId?: string;
  onSelectPlacement: (id: string) => void;
  isAddingPlacement: boolean;
}

export function SignaturePlacementsEditor({
  placements,
  signers,
  onPlacementsChange,
  onAddPlacement,
  selectedPlacementId,
  onSelectPlacement,
  isAddingPlacement
}: SignaturePlacementsEditorProps) {

  const getPlacementMeta = (placement: CustomPlacement): Record<string, unknown> => {
    if (!placement.meta || typeof placement.meta !== 'object') {
      return {};
    }
    return placement.meta;
  };

  const handleUpdatePlacement = (id: string, updates: Partial<CustomPlacement>) => {
    const newPlacements = placements.map(p => 
      p.id === id ? { ...p, ...updates } : p
    );
    onPlacementsChange(newPlacements);
  };

  const handleRemovePlacement = (id: string) => {
    onPlacementsChange(placements.filter(p => p.id !== id));
  };

  const handleMetaUpdate = (placement: CustomPlacement, key: string, value: unknown) => {
    const currentMeta = getPlacementMeta(placement);
    handleUpdatePlacement(placement.id, {
      meta: {
        ...currentMeta,
        [key]: value,
      },
    });
  };

  const handleOptionsUpdate = (placement: CustomPlacement, rawValue: string) => {
    const options = rawValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    handleMetaUpdate(placement, 'options', options);
  };

  // Helper to get signer label from roleKey
  const getSignerLabel = (roleKey: string) => {
    const signer = signers.find(s => s.roleKey === roleKey);
    return signer?.label || roleKey;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <Button 
        onClick={onAddPlacement} 
        size="sm" 
        variant={isAddingPlacement ? "default" : "outline"}
        className="w-full"
      >
        {isAddingPlacement ? (
          "✓ Click on PDF to Place Label"
        ) : (
          "+ Add Field Label"
        )}
      </Button>

      <ScrollArea className="flex-1 -mx-2 px-2">
        <div className="space-y-2 pb-4">
           {placements.length === 0 ? (
             <div className="text-xs text-muted-foreground p-6 text-center border-2 border-dashed rounded-lg bg-muted/20">
               <p className="font-medium mb-1">No custom fields yet</p>
               <p>Add a new label, then pick the field type and signer details.</p>
             </div>
           ) : (
             placements.map((placement) => (
               <Card 
                 key={placement.id}
                 className={cn(
                   "transition-all cursor-pointer border-l-4 hover:shadow-md",
                   selectedPlacementId === placement.id 
                     ? "border-l-primary bg-accent shadow-sm" 
                     : "border-l-transparent hover:border-l-muted-foreground/20"
                 )}
                 onClick={() => onSelectPlacement(placement.id)}
               >
                 <CardContent className="p-3">
                   <div className="flex items-start gap-2">
                     <div className="flex-1 space-y-2">
                       <div className="flex items-center gap-2">
                         <div className="flex-1">
                           <input
                             className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                             value={placement.label}
                             onChange={(e) => handleUpdatePlacement(placement.id, { label: e.target.value })}
                             placeholder="Field label"
                             onClick={(e) => e.stopPropagation()}
                           />
                         </div>
                         <div className="w-24 shrink-0">
                            <Select
                               value={isCustomFieldTypeOption(placement.fieldType) ? placement.fieldType : 'text'}
                               onValueChange={(val) => val && handleUpdatePlacement(placement.id, { fieldType: val as WaiverFieldType })}
                             >
                               <SelectTrigger className="h-8 text-[11px] px-2" onClick={(e) => e.stopPropagation()}>
                                 <SelectValue placeholder="Field Type">
                                   {CUSTOM_FIELD_TYPE_OPTIONS.find(o => o.value === (isCustomFieldTypeOption(placement.fieldType) ? placement.fieldType : 'text'))?.label}
                                 </SelectValue>
                               </SelectTrigger>
                               <SelectContent>
                                  {CUSTOM_FIELD_TYPE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value} className="text-xs">
                                      {option.label}
                                    </SelectItem>
                                  ))}
                               </SelectContent>
                             </Select>
                         </div>
                         <Badge variant="secondary" className="shrink-0 text-[10px] h-5">
                           P{placement.pageIndex + 1}
                         </Badge>
                       </div>

                       <div className="flex items-center gap-2">
                          <div className="flex-1">
                             <Select
                               value={placement.signerRoleKey}
                               onValueChange={(val) => val && handleUpdatePlacement(placement.id, { signerRoleKey: val })}
                             >
                               <SelectTrigger className="h-8 text-xs font-normal" onClick={(e) => e.stopPropagation()}>
                                 <SelectValue placeholder="Assign Role">
                                   {getSignerLabel(placement.signerRoleKey)}
                                 </SelectValue>
                               </SelectTrigger>
                               <SelectContent>
                                  {signers.map(s => (
                                    <SelectItem key={s.roleKey} value={s.roleKey} className="text-xs">
                                      {s.label}
                                    </SelectItem>
                                  ))}
                               </SelectContent>
                             </Select>
                          </div>
                          
                          <div className="flex items-center gap-1.5">
                             <Switch
                               id={`req-${placement.id}`}
                               checked={placement.required}
                               onCheckedChange={(checked) => handleUpdatePlacement(placement.id, { required: checked })}
                               className="scale-90"
                               onClick={(e: React.MouseEvent) => e.stopPropagation()}
                             />
                             <Label className="text-xs cursor-pointer" htmlFor={`req-${placement.id}`}>Required</Label>
                          </div>
                       </div>

                       <div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-2">
                         <p className="text-[11px] font-medium text-muted-foreground">Field guidance & e-sign details</p>

                         <Input
                           className="h-8 text-xs"
                           placeholder="What are they signing as? (e.g. Parent/Guardian Authorization)"
                           value={String(getPlacementMeta(placement).signingPurpose ?? '')}
                           onChange={(event) => handleMetaUpdate(placement, 'signingPurpose', event.target.value)}
                           onClick={(event) => event.stopPropagation()}
                         />

                         <Input
                           className="h-8 text-xs"
                           placeholder="Signer-facing explanation/help text"
                           value={String(getPlacementMeta(placement).helpText ?? '')}
                           onChange={(event) => handleMetaUpdate(placement, 'helpText', event.target.value)}
                           onClick={(event) => event.stopPropagation()}
                         />

                         {['text', 'name', 'email', 'phone', 'address', 'date'].includes(placement.fieldType) && (
                           <Input
                             className="h-8 text-xs"
                             placeholder="Placeholder text"
                             value={String(getPlacementMeta(placement).placeholder ?? '')}
                             onChange={(event) => handleMetaUpdate(placement, 'placeholder', event.target.value)}
                             onClick={(event) => event.stopPropagation()}
                           />
                         )}

                         {['radio', 'dropdown'].includes(placement.fieldType) && (
                           <Input
                             className="h-8 text-xs"
                             placeholder="Options (comma separated)"
                             value={Array.isArray(getPlacementMeta(placement).options)
                               ? (getPlacementMeta(placement).options as string[]).join(', ')
                               : ''}
                             onChange={(event) => handleOptionsUpdate(placement, event.target.value)}
                             onClick={(event) => event.stopPropagation()}
                           />
                         )}

                         {(placement.fieldType === 'signature' || placement.fieldType === 'initial') && (
                           <div className="grid grid-cols-2 gap-2 pt-1">
                             <div className="flex items-center gap-1.5">
                               <Switch
                                 id={`collect-name-${placement.id}`}
                                 checked={Boolean(getPlacementMeta(placement).collectSignerName)}
                                 onCheckedChange={(checked) => handleMetaUpdate(placement, 'collectSignerName', checked)}
                                 className="scale-90"
                                 onClick={(event: React.MouseEvent) => event.stopPropagation()}
                               />
                               <Label className="text-[11px] cursor-pointer" htmlFor={`collect-name-${placement.id}`}>Collect name</Label>
                             </div>
                             <div className="flex items-center gap-1.5">
                               <Switch
                                 id={`collect-email-${placement.id}`}
                                 checked={Boolean(getPlacementMeta(placement).collectSignerEmail)}
                                 onCheckedChange={(checked) => handleMetaUpdate(placement, 'collectSignerEmail', checked)}
                                 className="scale-90"
                                 onClick={(event: React.MouseEvent) => event.stopPropagation()}
                               />
                               <Label className="text-[11px] cursor-pointer" htmlFor={`collect-email-${placement.id}`}>Collect email</Label>
                             </div>
                             <div className="flex items-center gap-1.5">
                               <Switch
                                 id={`collect-phone-${placement.id}`}
                                 checked={Boolean(getPlacementMeta(placement).collectSignerPhone)}
                                 onCheckedChange={(checked) => handleMetaUpdate(placement, 'collectSignerPhone', checked)}
                                 className="scale-90"
                                 onClick={(event: React.MouseEvent) => event.stopPropagation()}
                               />
                               <Label className="text-[11px] cursor-pointer" htmlFor={`collect-phone-${placement.id}`}>Collect phone</Label>
                             </div>
                             <div className="flex items-center gap-1.5">
                               <Switch
                                 id={`collect-title-${placement.id}`}
                                 checked={Boolean(getPlacementMeta(placement).collectSignerTitle)}
                                 onCheckedChange={(checked) => handleMetaUpdate(placement, 'collectSignerTitle', checked)}
                                 className="scale-90"
                                 onClick={(event: React.MouseEvent) => event.stopPropagation()}
                               />
                               <Label className="text-[11px] cursor-pointer" htmlFor={`collect-title-${placement.id}`}>Collect signer title</Label>
                             </div>
                           </div>
                         )}
                       </div>
                     </div>
                     
                     <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePlacement(placement.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                   </div>
                 </CardContent>
               </Card>
             ))
           )}
        </div>
      </ScrollArea>
    </div>
  );
}