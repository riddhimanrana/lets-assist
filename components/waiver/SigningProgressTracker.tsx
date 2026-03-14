"use client";

import { WaiverDefinitionSigner } from "@/types/waiver-definitions";
import { Check, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface SigningProgressTrackerProps {
  signers: WaiverDefinitionSigner[];
  completedSigners: string[]; // Array of roleKeys
  currentSigner?: string;
  className?: string;
}

export function SigningProgressTracker({
  signers,
  completedSigners,
  currentSigner,
  className,
}: SigningProgressTrackerProps) {
  const sortedSigners = [...signers].sort((a, b) => a.order_index - b.order_index);
  const totalSteps = sortedSigners.length;
  const completedCount = completedSigners.length;
  const percentage = Math.round((completedCount / totalSteps) * 100);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted-foreground">Signing Progress</span>
        <span className="font-semibold text-primary">{percentage}% Complete</span>
      </div>
      
      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
        <div 
            className="h-full bg-primary transition-all duration-500 ease-in-out" 
            style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="space-y-2">
        {sortedSigners.map((signer) => {
          const isCompleted = completedSigners.includes(signer.role_key);
          const isCurrent = signer.role_key === currentSigner;

          return (
            <div 
                key={signer.id}
                className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                    isCompleted ? "bg-green-50/50 border-green-200 dark:bg-green-900/10 dark:border-green-900/30" : 
                    isCurrent ? "bg-primary/5 border-primary/20 ring-1 ring-primary/10" : 
                    "bg-background border-transparent text-muted-foreground opacity-70"
                )}
            >
                <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center shrink-0 border",
                    isCompleted ? "bg-green-100 text-green-600 border-green-200 dark:bg-green-900/40 dark:text-green-400" :
                    isCurrent ? "bg-primary text-primary-foreground border-primary" :
                    "bg-muted text-muted-foreground border-muted-foreground/20"
                )}>
                    {isCompleted ? <Check className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
                
                <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", isCurrent && "text-primary")}>
                        {signer.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                        {isCompleted ? "Signed" : isCurrent ? "Signing Now..." : "Waiting..."}
                    </p>
                </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
