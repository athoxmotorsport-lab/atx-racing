import { adminClient } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://athoxmotorsport-lab.github.io",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
});

const average = (values: number[]): number | null => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : null;

const performanceClass = (score: number | null): "alien" | "elite" | "pro" | "rookie" | "unranked" => {
  if (score === null) return "unranked";
  if (score < 102) return "alien";
  if (score < 104) return "elite";
  if (score < 106) return "pro";
  return "rookie";
};

const safetyClass = (score: number | null): "gold" | "silver" | "bronze" | null => {
  if (score === null || score < 39) return null;
  if (score >= 80) return "gold";
  if (score >= 60) return "silver";
  return "bronze";
};

const normaliseSessionType = (value: unknown): "FP" | "Q" | "R" | null => {
  const type = String(value ?? "").toUpperCase();
  return type === "FP" || type === "Q" || type === "R" ? type : null;
};

const canonicalCircuitKey = (value: unknown): string => {
  const key = String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    nurburgring_gp: "nurburgring",
    nurburgring_2020: "nurburgring",
    nurburgring_gp_2020: "nurburgring",
    spa_francorchamps: "spa",
    circuit_of_the_americas: "cota",
  };
  return aliases[key] ?? key;
};

const circuits = [
  ["barcelona", "Barcelona"], ["brands_hatch", "Brands Hatch"], ["cota", "Circuit of the Americas"], ["donington", "Donington Park"], ["hungaroring", "Hungaroring"],
  ["imola", "Imola"], ["indianapolis", "Indianapolis"], ["kyalami", "Kyalami"], ["laguna_seca", "Laguna Seca"], ["misano", "Misano"],
  ["monza", "Monza"], ["mount_panorama", "Mount Panorama"], ["nurburgring", "Nürburgring GP"], ["nurburgring_24h", "Nürburgring 24h"], ["oulton_park", "Oulton Park"],
  ["paul_ricard", "Paul Ricard"], ["red_bull_ring", "Red Bull Ring"], ["silverstone", "Silverstone"], ["snetterton", "Snetterton"], ["spa", "Spa-Francorchamps"],
  ["suzuka", "Suzuka"], ["valencia", "Valencia"], ["watkins_glen", "Watkins Glen"], ["zandvoort", "Zandvoort"], ["zolder", "Zolder"],
] as const;

type SessionType = "FP" | "Q" | "R";
type BestLap = { lap_ms: number; session_type: SessionType; at: string };
type SessionLaps = { FP: number | null; Q: number | null; R: number | null };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabase = adminClient();

    const { data: drivers, error: driversError } = await supabase.from("drivers")
      .select("id, display_name, avatar_url, team_name").eq("is_profile_public", true);
    if (driversError) throw driversError;

    const { data: claimedRows, error: claimedError } = await supabase.from("driver_identities")
      .select("driver_id").not("last_login_at", "is", null);
    if (claimedError) throw claimedError;
    const claimed = new Set((claimedRows ?? []).map((row) => row.driver_id));

    const results: Array<Record<string, unknown>> = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.from("results")
        .select("driver_id, status, finish_position, points, best_lap_ms, created_at, event:events!inner(id, circuit_key, circuit_name, starts_at, is_public)")
        .eq("event.is_public", true).order("created_at", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      results.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const sessionResults: Array<Record<string, unknown>> = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.from("acc_session_results")
        .select("driver_id, best_lap_ms, created_at, session:acc_sessions!inner(session_type, session_date, published_at, created_at, event:events!inner(circuit_key, circuit_name, is_public))")
        .order("created_at", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      sessionResults.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const publicSessionResults = sessionResults.filter((result) => {
      const session = Array.isArray(result.session) ? result.session[0] : result.session as Record<string, unknown> | null;
      const event = Array.isArray(session?.event) ? session.event[0] : session?.event as Record<string, unknown> | null;
      return event?.is_public === true;
    });

    const { data: ratings, error: ratingsError } = await supabase.from("driver_ratings")
      .select("driver_id, safety_class, safety_score").eq("circuit_key", "overall");
    if (ratingsError) throw ratingsError;
    const ratingByDriver = new Map((ratings ?? []).map((rating) => [rating.driver_id, rating]));

    const bestByDriverCircuit = new Map<string, BestLap>();
    const bestByDriverCircuitSession = new Map<string, BestLap>();
    const timelineByDriver = new Map<string, Array<{ at: number; circuit_key: string; lap_ms: number }>>();

    for (const result of publicSessionResults) {
      const session = Array.isArray(result.session) ? result.session[0] : result.session as Record<string, unknown> | null;
      const event = Array.isArray(session?.event) ? session.event[0] : session?.event as Record<string, unknown> | null;
      const circuitKey = canonicalCircuitKey(event?.circuit_key ?? event?.circuit_name);
      const lap = Number(result.best_lap_ms);
      const sessionType = normaliseSessionType(session?.session_type);
      if (!circuitKey || !sessionType || !Number.isFinite(lap) || lap <= 0) continue;

      const achievedAt = String(session?.published_at ?? session?.created_at ?? result.created_at ?? "");
      const baseKey = `${result.driver_id}|${circuitKey}`;
      const sessionKey = `${baseKey}|${sessionType}`;
      const best: BestLap = { lap_ms: lap, session_type: sessionType, at: achievedAt };

      const currentOverall = bestByDriverCircuit.get(baseKey);
      if (!currentOverall || lap < currentOverall.lap_ms) bestByDriverCircuit.set(baseKey, best);

      const currentSession = bestByDriverCircuitSession.get(sessionKey);
      if (!currentSession || lap < currentSession.lap_ms) bestByDriverCircuitSession.set(sessionKey, best);

      const timeline = timelineByDriver.get(String(result.driver_id)) ?? [];
      timeline.push({ at: Date.parse(achievedAt) || 0, circuit_key: circuitKey, lap_ms: lap });
      timelineByDriver.set(String(result.driver_id), timeline);
    }

    const referenceByCircuit = new Map<string, BestLap & { driver_id: string }>();
    for (const [key, best] of bestByDriverCircuit) {
      const separator = key.indexOf("|");
      const driverId = key.slice(0, separator);
      const circuitKey = key.slice(separator + 1);
      const current = referenceByCircuit.get(circuitKey);
      if (!current || best.lap_ms < current.lap_ms) referenceByCircuit.set(circuitKey, { ...best, driver_id: driverId });
    }

    const getSessionLaps = (driverId: string, circuitKey: string): SessionLaps => ({
      FP: bestByDriverCircuitSession.get(`${driverId}|${circuitKey}|FP`)?.lap_ms ?? null,
      Q: bestByDriverCircuitSession.get(`${driverId}|${circuitKey}|Q`)?.lap_ms ?? null,
      R: bestByDriverCircuitSession.get(`${driverId}|${circuitKey}|R`)?.lap_ms ?? null,
    });

    const rows = (drivers ?? []).map((driver) => {
      const driverResults = results.filter((result) => result.driver_id === driver.id);
      const circuitPaces: number[] = [];
      for (const [circuitKey] of circuits) {
        const best = bestByDriverCircuit.get(`${driver.id}|${circuitKey}`);
        const reference = referenceByCircuit.get(circuitKey);
        if (best && reference) circuitPaces.push(best.lap_ms / reference.lap_ms * 100);
      }
      const paceScore = average(circuitPaces);

      const timeline = (timelineByDriver.get(driver.id) ?? []).flatMap((item) => {
        const reference = referenceByCircuit.get(item.circuit_key);
        return reference ? [{ at: item.at, pace: item.lap_ms / reference.lap_ms * 100 }] : [];
      }).sort((a, b) => a.at - b.at);
      const recent = timeline.slice(-3).map((item) => item.pace);
      const previous = timeline.slice(-6, -3).map((item) => item.pace);
      const recentAverage = average(recent);
      const previousAverage = average(previous);
      const trend = recentAverage !== null && previousAverage !== null ? previousAverage - recentAverage : null;
      const safety = ratingByDriver.get(driver.id);

      return {
        driver_id: driver.id,
        profile_id: claimed.has(driver.id) ? driver.id : null,
        display_name: driver.display_name,
        avatar_url: driver.avatar_url,
        team_name: driver.team_name,
        races: driverResults.length,
        wins: driverResults.filter((result) => result.status === "classified" && result.finish_position === 1).length,
        podiums: driverResults.filter((result) => result.status === "classified" && Number(result.finish_position) <= 3).length,
        points: driverResults.reduce((total, result) => total + Number(result.points ?? 0), 0),
        points_per_race: driverResults.length ? driverResults.reduce((total, result) => total + Number(result.points ?? 0), 0) / driverResults.length : 0,
        circuits: circuitPaces.length,
        performance_score: paceScore === null ? null : Number(paceScore.toFixed(3)),
        performance_class: performanceClass(paceScore),
        progression: trend === null ? null : Number(trend.toFixed(3)),
        safety_class: safetyClass(safety?.safety_score == null ? null : Number(safety.safety_score)),
        safety_score: safety?.safety_score ?? null,
      };
    }).filter((row) => row.circuits > 0)
      .sort((first, second) => second.points - first.points || second.wins - first.wins || (first.performance_score ?? 999) - (second.performance_score ?? 999))
      .map((row, index) => ({ rank: index + 1, ...row }));

    const circuitRankings = circuits.map(([circuitKey, circuitName]) => {
      const reference = referenceByCircuit.get(circuitKey) ?? null;
      const referenceDriver = reference ? (drivers ?? []).find((driver) => driver.id === reference.driver_id) : null;
      const entries = (drivers ?? []).flatMap((driver) => {
        const best = bestByDriverCircuit.get(`${driver.id}|${circuitKey}`);
        if (!best) return [];
        return [{
          driver_id: driver.id,
          profile_id: claimed.has(driver.id) ? driver.id : null,
          display_name: driver.display_name,
          avatar_url: driver.avatar_url,
          best_lap_ms: best.lap_ms,
          session_type: best.session_type,
          session_laps: getSessionLaps(driver.id, circuitKey),
          achieved_at: best.at,
          pace_percent: reference ? Number((best.lap_ms / reference.lap_ms * 100).toFixed(3)) : null,
          performance_class: reference ? performanceClass(best.lap_ms / reference.lap_ms * 100) : "unranked",
        }];
      }).sort((first, second) => first.best_lap_ms - second.best_lap_ms || first.display_name.localeCompare(second.display_name));

      return {
        circuit_key: circuitKey,
        circuit_name: circuitName,
        reference_lap_ms: reference?.lap_ms ?? null,
        reference_driver: referenceDriver?.display_name ?? null,
        reference_session_type: reference?.session_type ?? null,
        drivers: entries,
      };
    });

    const teamGroups = new Map<string, { team_name: string; points: number; races: number; wins: number; podiums: number; member_ids: Set<string>; pace_scores: number[] }>();
    for (const driver of rows) {
      const teamName = String(driver.team_name ?? "").trim();
      if (!teamName) continue;
      const key = teamName.toLocaleLowerCase("fr");
      const team = teamGroups.get(key) ?? { team_name: teamName, points: 0, races: 0, wins: 0, podiums: 0, member_ids: new Set<string>(), pace_scores: [] };
      team.points += Number(driver.points ?? 0);
      team.races += Number(driver.races ?? 0);
      team.wins += Number(driver.wins ?? 0);
      team.podiums += Number(driver.podiums ?? 0);
      team.member_ids.add(driver.driver_id);
      if (driver.performance_score !== null) team.pace_scores.push(Number(driver.performance_score));
      teamGroups.set(key, team);
    }

    const teams = [...teamGroups.values()].map((team) => ({
      team_name: team.team_name,
      points: team.points,
      races: team.races,
      wins: team.wins,
      podiums: team.podiums,
      drivers: team.member_ids.size,
      performance_score: average(team.pace_scores),
    })).sort((first, second) => second.points - first.points || second.wins - first.wins)
      .map((team, index) => ({ rank: index + 1, ...team }));

    return json({ generated_at: new Date().toISOString(), drivers: rows, circuits: circuitRankings, teams });
  } catch (error) {
    console.error("Leaderboard failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
});