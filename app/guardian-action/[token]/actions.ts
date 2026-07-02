"use server";

import { redirect } from "next/navigation";
import { GuardianTokenService } from "@/lib/dv/guardian-token-service";

export async function confirmGuardianAvailability(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["available", "limited", "unavailable"].includes(status)) {
    throw new Error("Select an availability status.");
  }

  await GuardianTokenService.consumeAvailability({
    token,
    status: status as "available" | "limited" | "unavailable",
    availableRounds: formData
      .getAll("round")
      .map((round) => String(round))
      .filter(Boolean),
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  redirect(`/guardian-action/${encodeURIComponent(token)}?completed=1`);
}
