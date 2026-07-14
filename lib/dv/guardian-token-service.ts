import "server-only";

import { createHash } from "node:crypto";

import { hasOrganizationPluginRuntimeAccess } from "@/lib/plugins/runtime-access";
import { createPluginAdminClient } from "@/lib/plugins/supabase";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isGuardianCapability(token: string) {
  return /^[A-Za-z0-9_-]{43}$/u.test(token);
}

export const GuardianTokenService = {
  async inspect(token: string) {
    if (!isGuardianCapability(token)) {
      return { valid: false as const, reason: "not_found" };
    }

    const admin = createPluginAdminClient();
    const { data, error } = await admin
      .from("dv_sd_guardian_action_tokens")
      .select(
        "id,organization_id,guardian_id,purpose,payload,expires_at,consumed_at,dv_sd_guardians(full_name,email,organization_id)",
      )
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (error) throw error;
    if (!data) return { valid: false as const, reason: "not_found" };
    if (data.consumed_at) return { valid: false as const, reason: "consumed" };
    if (new Date(data.expires_at) <= new Date()) {
      return { valid: false as const, reason: "expired" };
    }

    const guardianRelation = data.dv_sd_guardians as
      | { full_name: string; email: string; organization_id: string }
      | { full_name: string; email: string; organization_id: string }[]
      | null;
    const guardian = Array.isArray(guardianRelation)
      ? guardianRelation[0]
      : guardianRelation;
    if (!guardian || guardian.organization_id !== data.organization_id) {
      return { valid: false as const, reason: "not_found" };
    }

    const hasRuntimeAccess = await hasOrganizationPluginRuntimeAccess({
      organizationId: data.organization_id,
      pluginKey: "dv-speech-debate",
    });
    if (!hasRuntimeAccess) {
      return { valid: false as const, reason: "not_found" };
    }

    return {
      valid: true as const,
      action: { ...data, dv_sd_guardians: guardian },
    };
  },

  async consumeAvailability(input: {
    token: string;
    status: "available" | "limited" | "unavailable";
    availableRounds?: string[];
    notes?: string | null;
  }) {
    if (!isGuardianCapability(input.token)) {
      throw new Error("Guardian link is not_found.");
    }
    if (input.availableRounds && input.availableRounds.length > 50) {
      throw new Error("Too many availability rounds were submitted.");
    }

    const availableRounds = (input.availableRounds ?? []).map((round) => {
      const normalized = round.trim();
      if (!normalized || normalized.length > 100) {
        throw new Error("Availability round labels must be 1-100 characters.");
      }
      return normalized;
    });
    const notes = input.notes?.trim() || null;
    if (notes && notes.length > 2_000) {
      throw new Error("Availability notes cannot exceed 2,000 characters.");
    }

    const inspected = await this.inspect(input.token);
    if (!inspected.valid) throw new Error(`Guardian link is ${inspected.reason}.`);
    if (inspected.action.purpose !== "confirm_availability") {
      throw new Error("Guardian link has the wrong purpose.");
    }

    const admin = createPluginAdminClient();
    const { error } = await admin.rpc("consume_dv_guardian_availability", {
      p_token_hash: hashToken(input.token),
      p_status: input.status,
      p_available_rounds: availableRounds,
      p_notes: notes,
    });
    if (error) throw new Error(error.message);
  },
};
