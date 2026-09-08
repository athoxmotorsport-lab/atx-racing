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
  if (score <= 101.99) return "alien";
  if (score <= 105.99) return "elite";
  if (score <= 108.99) return "pro";
  return "rookie";
};

const circuits = [
  ["barcelona", "Barcelona"], ["brands_hatch", "Brands Hatch"], ["cota", "Circuit of the Americas"], ["donington", "Donington Park"], ["hungaroring", "Hungaroring"],
  ["imola", "Imola"], ["indianapolis", "Indianapolis"], ["kyalami", "Kyalami"], ["laguna_seca", "Laguna Seca"], ["misano", "Misano"],
  ["monza", "Monza"], ["mount_panorama", "Mount Panorama"], ["nurburgring", "Nürburgring GP"], ["nurburgring_24h", "Nürburgring 24h"], ["oulton_park", "Oulton Park"],
  ["paul_ricard", "Paul Ricard"], ["red_bull_ring", "Red Bull Ring"], ["silverstone", "Silverstone"], ["snetterton", "Snetterton"], ["spa", "Spa-Francorchamps"],
  ["suzuka", "Suzuka"], ["valencia", "Valencia"], ["watkins_glen", "Watkins Glen"], ["zandvoort", "Zandvoort"], ["zolder", "Zolder"],
] as const;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const supabase = adminClient();
    const { data: drivers, error: driversError } = await supabase.from("drivers")
      .select("id, display_name, avatar_url").eq("is_profile_public", true);
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

    const { data: ratings, error: ratingsError } = await supabase.from("driver_ratings")
      .select("driver_id, safety_class, safety_score").eq("circuit_key", "overall");
    if (ratingsError) throw ratingsError;
    const ratingByDriver = new Map((ratings ?? []).map((rating) => [rating.driver_id, rating]));

    const eventReferences = new Map<string, number>();
    for (const result of results) {
      const event = Array.isArray(result.event) ? result.event[0] : result.event as Record<string, unknown> | null;
      const eventId = String(event?.id ?? "");
      const lap = Number(result.best_lap_ms);
      if (!eventId || !Number.isFinite(lap) || lap <= 0) continue;
      const reference = eventReferences.get(eventId);
      if (!reference || lap < reference) eventReferences.set(eventId, lap);
    }

    const rows = (drivers ?? []).map((driver) => {
      const driverResults = results.filter((result) => result.driver_id === driver.id);
      const circuitBest = new Map<string, number>();
      const timeline: Array<{ at: number; pace: number }> = [];
      for (const result of driverResults) {
        const event = Array.isArray(result.event) ? result.event[0] : result.event as Record<string, unknown> | null;
        const eventId = String(event?.id ?? "");
        const circuitKey = String(event?.circuit_key ?? "");
        const lap = Number(result.best_lap_ms);
        const reference = eventReferences.get(eventId);
        if (!circuitKey || !reference || !Number.isFinite(lap) || lap <= 0) continue;
        const pace = lap / reference * 100;
        const current = circuitBest.get(circuitKey);
        if (!current || pace < current) circuitBest.set(circuitKey, pace);
        timeline.push({ at: Date.parse(String(event?.starts_at ?? result.created_at ?? "")), pace });
      }
      const paceScore = average([...circuitBest.values()]);
      timeline.sort((a, b) => a.at - b.at);
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
        races: driverResults.length,
        wins: driverResults.filter((result) => result.status === "classified" && result.finish_position === 1).length,
        podiums: driverResults.filter((result) => result.status === "classified" && Number(result.finish_position) <= 3).length,
        points: driverResults.reduce((total, result) => total + Number(result.points ?? 0), 0),
        points_per_race: driverResults.length ? driverResults.reduce((total, result) => total + Number(result.points ?? 0), 0) / driverResults.length : 0,
        circuits: circuitBest.size,
        performance_score: paceScore === null ? null : Number(paceScore.toFixed(3)),
        performance_class: performanceClass(paceScore),
        progression: trend === null ? null : Number(trend.toFixed(3)),
        safety_class: safety?.safety_class ?? null,
        safety_score: safety?.safety_score ?? null,
      };
    }).filter((row) => row.races > 0)
      .sort((first, second) => second.points - first.points || second.wins - first.wins ||
        (first.performance_score ?? 999) - (second.performance_score ?? 999))
      .map((row, index) => ({ rank: index + 1, ...row }));

    const bestByDriverCircuit = new Map<string, { lap_ms: number; at: string }>();
    for (const result of results) {
      const event = Array.isArray(result.event) ? result.event[0] : result.event as Record<string, unknown> | null;
      const circuitKey = String(event?.circuit_key ?? "");
      const lap = Number(result.best_lap_ms);
      if (!circuitKey || !Number.isFinite(lap) || lap <= 0) continue;
      const key = `${result.driver_id}|${circuitKey}`;
      const current = bestByDriverCircuit.get(key);
      if (!current || lap < current.lap_ms) bestByDriverCircuit.set(key, { lap_ms: lap, at: String(event?.starts_at ?? "") });
    }

    const circuitRankings = circuits.map(([circuitKey, circuitName]) => {
      const entries = (drivers ?? []).map((driver) => {
        const best = bestByDriverCircuit.get(`${driver.id}|${circuitKey}`);
        return {
          driver_id: driver.id,
          profile_id: claimed.has(driver.id) ? driver.id : null,
          display_name: driver.display_name,
          avatar_url: driver.avatar_url,
          best_lap_ms: best?.lap_ms ?? null,
          achieved_at: best?.at ?? null,
        };
      });
      const reference = Math.min(...entries.flatMap((entry) => entry.best_lap_ms ? [entry.best_lap_ms] : []));
      return {
        circuit_key: circuitKey,
        circuit_name: circuitName,
        reference_lap_ms: Number.isFinite(reference) ? reference : null,
        reference_driver: Number.isFinite(reference) ? entries.find((entry) => entry.best_lap_ms === reference)?.display_name ?? null : null,
        drivers: entries.map((entry) => ({
          ...entry,
          pace_percent: entry.best_lap_ms && Number.isFinite(reference) ? Number((entry.best_lap_ms / reference * 100).toFixed(3)) : null,
          performance_class: entry.best_lap_ms && Number.isFinite(reference) ? performanceClass(entry.best_lap_ms / reference * 100) : "unranked",
        })).sort((first, second) => (first.best_lap_ms ?? Number.MAX_SAFE_INTEGER) - (second.best_lap_ms ?? Number.MAX_SAFE_INTEGER) || first.display_name.localeCompare(second.display_name)),
      };
    });

    return json({ generated_at: new Date().toISOString(), drivers: rows, circuits: circuitRankings });
  } catch (error) {
    console.error("Leaderboard failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
});
