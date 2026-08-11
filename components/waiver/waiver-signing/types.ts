import type { WaiverDefinitionSigner } from "@/types/waiver-definitions";

export type WaiverSigningStepType = "review" | "fields" | "sign" | "confirm";

export interface WaiverSigningStep {
  id: string;
  type: WaiverSigningStepType;
  title: string;
  description?: string;
  signer?: WaiverDefinitionSigner;
  isLast?: boolean;
}
