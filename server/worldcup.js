/**
 * Live World Cup 2026 data source. https://worldcup26.ir is a real, publicly
 * reachable API tracking the actual 2026 tournament (verified 2026-07-11: /health
 * returns 200, /get/games returns real finished/live fixtures with scorers).
 * No API key required for these read endpoints in practice.
 */
const BASE = "https://worldcup26.ir";

let cache = { games: [], teams: [], fetchedAt: 0 };
const TTL_MS = 15_000;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`worldcup26 ${path} -> ${res.status}`);
  return res.json();
}

export async function refresh() {
  const now = Date.now();
  if (now - cache.fetchedAt < TTL_MS && cache.games.length) return cache;
  try {
    const [gamesRes, teamsRes] = await Promise.all([
      fetchJson("/get/games"),
      fetchJson("/get/teams").catch(() => ({ teams: [] })),
    ]);
    cache = { games: gamesRes.games || [], teams: teamsRes.teams || [], fetchedAt: now };
  } catch (err) {
    console.error("[worldcup] refresh failed, serving stale/empty cache:", err.message);
  }
  return cache;
}

export async function getGames() {
  return (await refresh()).games;
}

/** Very small plain-English answer engine over live match data — no LLM needed for the core facts. */
export async function answerQuestion(question) {
  const games = await getGames();
  const q = question.toLowerCase();

  // Future knockout-stage fixtures can have undetermined teams (no name yet) — skip those safely.
  const named = games.filter(
    (g) =>
      (g.home_team_name_en && q.includes(g.home_team_name_en.toLowerCase())) ||
      (g.away_team_name_en && q.includes(g.away_team_name_en.toLowerCase()))
  );

  if (/live|now|score/.test(q) && named.length) {
    const g = named[named.length - 1];
    const status = g.finished === "TRUE" ? "finished" : g.time_elapsed || "scheduled";
    return `${g.home_team_name_en} ${g.home_score}-${g.away_score} ${g.away_team_name_en} (${status}, group ${g.group}).`;
  }

  if (named.length) {
    const g = named[named.length - 1];
    return `${g.home_team_name_en} vs ${g.away_team_name_en}: ${g.home_score}-${g.away_score}, group ${g.group}, kicked off ${g.local_date}.`;
  }

  const liveNow = games.find((g) => g.finished !== "TRUE" && g.time_elapsed && g.time_elapsed !== "finished");
  if (liveNow) {
    return `Live now: ${liveNow.home_team_name_en} ${liveNow.home_score}-${liveNow.away_score} ${liveNow.away_team_name_en} (${liveNow.time_elapsed}).`;
  }

  const finishedCount = games.filter((g) => g.finished === "TRUE").length;
  return `I don't have a specific match for that question. ${finishedCount} World Cup 2026 matches have been played so far — ask me about a specific team.`;
}

/** Structured (not prose) match data for a team — this is Scout's product: raw facts, not a narrated answer. */
export async function lookupTeamMatches(team) {
  const games = await getGames();
  const t = team.toLowerCase();
  return games
    .filter((g) => g.home_team_name_en?.toLowerCase() === t || g.away_team_name_en?.toLowerCase() === t)
    .map((g) => ({
      matchId: g.id,
      homeTeam: g.home_team_name_en,
      awayTeam: g.away_team_name_en,
      homeScore: g.home_score,
      awayScore: g.away_score,
      homeScorers: g.home_scorers,
      awayScorers: g.away_scorers,
      group: g.group,
      date: g.local_date,
      finished: g.finished === "TRUE",
    }));
}

/** Returns newly-scored goals since the last poll, keyed by matchId, for the autonomous tipper agent. */
let lastGoalCounts = new Map();
export async function detectNewGoals() {
  const games = await getGames();
  const events = [];
  for (const g of games) {
    const total = Number(g.home_score || 0) + Number(g.away_score || 0);
    const prev = lastGoalCounts.get(g.id) ?? total;
    if (total > prev) {
      events.push({
        matchId: g.id,
        homeTeam: g.home_team_name_en,
        awayTeam: g.away_team_name_en,
        homeScore: g.home_score,
        awayScore: g.away_score,
      });
    }
    lastGoalCounts.set(g.id, total);
  }
  return events;
}
