import { createHash } from "node:crypto";
import { getAdminClient } from "@/lib/supabase/admin";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const GuardianTokenService = {
  async inspect(token: string) {
    const admin = getAdminClient().schema("plugin_data");
    const { data, error } = await admin
      .from("dv_sd_guardian_action_tokens")
      .select(
        "id,organization_id,guardian_id,purpose,payload,expires_at,consumed_at,dv_sd_guardians(full_name,email)",
      )
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (error) throw error;
    if (!data) return { valid: false as const, reason: "not_found" };
    if (data.consumed_at) return { valid: false as const, reason: "consumed" };
    if (new Date(data.expires_at) <= new Date()) {
      return { valid: false as const, reason: "expired" };
    }
    return { valid: true as const, action: data };
  },

  async consumeAvailability(input: {
    token: string;
    status: "available" | "limited" | "unavailable";
    availableRounds?: string[];
    notes?: string | null;
  }) {
    const inspected = await this.inspect(input.token);
    if (!inspected.valid) throw new Error(`Guardian link is ${inspected.reason}.`);
    if (inspected.action.purpose !== "confirm_availability") {
      throw new Error("Guardian link has the wrong purpose.");
    }

    const payload = inspected.action.payload as {
      tournamentId?: string;
      judgeId?: string;
    };
    if (!payload.tournamentId || !payload.judgeId) {
      throw new Error("Guardian link payload is incomplete.");
    }

    const admin = getAdminClient().schema("plugin_data");
    const consumedAt = new Date().toISOString();
    const { data: consumed, error: consumeError } = await admin
      .from("dv_sd_guardian_action_tokens")
      .update({ consumed_at: consumedAt })
      .eq("id", inspected.action.id)
      .is("consumed_at", null)
      .gt("expires_at", consumedAt)
      .select("id")
      .maybeSingle();
    if (consumeError) throw consumeError;
    if (!consumed) throw new Error("Guardian link was already used or expired.");

    const { error: availabilityError } = await admin
      .from("dv_sd_judge_availability")
      .upsert(
        {
          organization_id: inspected.action.organization_id,
          tournament_id: payload.tournamentId,
          judge_id: payload.judgeId,
          status: input.status,
          available_rounds: input.availableRounds ?? [],
          notes: input.notes ?? null,
          confirmed_at: consumedAt,
          updated_at: consumedAt,
        },
        { onConflict: "tournament_id,judge_id" },
      );
    if (availabilityError) throw availabilityError;

    const { error: auditError } = await admin.from("dv_sd_audit_events").insert({
      organization_id: inspected.action.organization_id,
      action: "guardian.availability_confirmed",
      entity_type: "judge_availability",
      entity_id: payload.judgeId,
      after_data: {
        tournamentId: payload.tournamentId,
        status: input.status,
        availableRounds: input.availableRounds ?? [],
      },
      metadata: { tokenId: inspected.action.id },
    });
    if (auditError) throw auditError;
  },
};
