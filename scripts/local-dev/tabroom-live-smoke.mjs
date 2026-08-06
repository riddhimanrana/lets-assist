#!/usr/bin/env node

if (process.env.DV_TABROOM_LIVE !== "1") {
  throw new Error("Live Tabroom smoke test requires DV_TABROOM_LIVE=1.");
}

const tournamentId = process.env.DV_TABROOM_TOURNAMENT_ID;
if (!tournamentId || !/^\d+$/.test(tournamentId)) {
  throw new Error("Set DV_TABROOM_TOURNAMENT_ID to a numeric tournament ID.");
}

const tabroom = await import("@gmitch215/tabroom-api");
const tournament = await tabroom.dev.gmitch215.tabroom.api.getTournament(
  Number(tournamentId),
);

console.log(
  JSON.stringify({
    id: tournamentId,
    name: tournament?.name ?? null,
    eventCount: Array.isArray(tournament?.events)
      ? tournament.events.length
      : 0,
  }),
);
