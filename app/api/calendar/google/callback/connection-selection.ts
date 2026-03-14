export type ExistingGoogleConnection = {
  id: string;
  refresh_token: string | null;
  connection_type: string | null;
  updated_at?: string | null;
  connected_at?: string | null;
};

export type DesiredGoogleConnectionType = "calendar" | "sheets" | "both";

const rankConnectionType = (
  candidateType: string | null | undefined,
  desiredType: DesiredGoogleConnectionType
): number => {
  const normalized = (candidateType || "").toLowerCase();

  if (desiredType === "calendar") {
    if (normalized === "calendar") return 0;
    if (normalized === "both") return 1;
    if (normalized === "sheets") return 2;
    return 3;
  }

  if (desiredType === "sheets") {
    if (normalized === "sheets") return 0;
    if (normalized === "both") return 1;
    if (normalized === "calendar") return 2;
    return 3;
  }

  // desiredType === "both"
  if (normalized === "both") return 0;
  if (normalized === "calendar" || normalized === "sheets") return 1;
  return 2;
};

const getConnectionTimestamp = (
  connection: Pick<ExistingGoogleConnection, "updated_at" | "connected_at">
): number => {
  const rawTimestamp = connection.updated_at || connection.connected_at;
  if (!rawTimestamp) return 0;
  const parsed = Date.parse(rawTimestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Pick the best existing Google connection to update during OAuth callback.
 *
 * We intentionally consider inactive rows to preserve preferences like
 * `volunteering_calendar_id` across disconnect/reconnect cycles.
 */
export function pickBestExistingGoogleConnection(
  connections: ExistingGoogleConnection[] | null | undefined,
  desiredType: DesiredGoogleConnectionType
): ExistingGoogleConnection | null {
  if (!connections?.length) {
    return null;
  }

  let best: ExistingGoogleConnection | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestTimestamp = 0;

  for (const connection of connections) {
    const rank = rankConnectionType(connection.connection_type, desiredType);
    const timestamp = getConnectionTimestamp(connection);

    if (
      !best ||
      rank < bestRank ||
      (rank === bestRank && timestamp > bestTimestamp)
    ) {
      best = connection;
      bestRank = rank;
      bestTimestamp = timestamp;
    }
  }

  return best;
}