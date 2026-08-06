import type { CustomPlacement } from "../PdfViewerWithOverlay";
import type { FieldMapping } from "../FieldListPanel";
import type { WaiverDefinitionSignerInput } from "../SignerRolesEditor";

export interface WaiverDefinitionInput {
  signers: WaiverDefinitionSignerInput[];
  fields: {
    detected: Record<string, FieldMapping>;
    custom: CustomPlacement[];
  };
}
