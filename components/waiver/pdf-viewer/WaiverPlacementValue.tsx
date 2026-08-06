"use client";

import { cn } from "@/lib/utils";
import type { CustomPlacement } from "./types";
import type { SignerData } from "@/types/waiver-definitions";

export function WaiverPlacementValue({
  placement,
  fieldValue,
  signature,
}: {
  placement: CustomPlacement;
  fieldValue: string | boolean | number | null | undefined;
  signature?: SignerData;
}) {
  // IMPORTANT: This overlay renders on top of a PDF canvas which is typically a white page,
  // even when the app theme is dark. Keep the ink color black for readability.
  const inkClass = "text-black/90";

  if (placement.fieldType === "signature") {
    if (!signature) return null;

    if (signature.method === "typed") {
      const text = signature.data?.trim();
      if (!text) return null;
      return (
        <span
          data-testid="waiver-placement-signature-typed"
          className={cn(
            "text-[11px] md:text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-full",
            inkClass,
          )}
          style={{ fontFamily: "cursive" }}
        >
          {text}
        </span>
      );
    }

    const src = signature.data;
    if (!src) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        data-testid="waiver-placement-signature-image"
        alt={placement.label ? `${placement.label} signature` : "Signature"}
        src={src}
        className="max-h-full max-w-full object-contain opacity-90"
      />
    );
  }

  if (typeof fieldValue === "boolean") {
    if (!fieldValue) return null;
    return (
      <span
        data-testid="waiver-placement-checkbox"
        className={cn("text-base md:text-lg font-bold", inkClass)}
        aria-label="Checked"
      >
        ✓
      </span>
    );
  }

  if (fieldValue === null || fieldValue === undefined) return null;
  const text = String(fieldValue).trim();
  if (!text) return null;

  return (
    <span
      data-testid="waiver-placement-text"
      className={cn(
        "text-[11px] md:text-xs font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-full",
        inkClass,
      )}
    >
      {text}
    </span>
  );
}
