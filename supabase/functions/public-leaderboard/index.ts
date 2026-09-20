import { adminClient } from "../_shared/auth.ts";
import { worldGTPoints } from "../_shared/worldgt-scoring.ts";

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

type RaceCategory = "WGT" | "DR" | "OL";
type RankingScope = RaceCategory | "ALL";
type SteamIdentity = {
  driver_id: string;
  steam_id64: string;
  steam_persona_name: string | null;
  steam_profile_url: string | null;
  steam_avatar_url: string | null;
  last_login_at: string | null;
};
const DEFAULT_STEAM_AVATAR = "https://avatars.akamai.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";

const usableAvatarUrl = (value: unknown): boolean => {
  const url = String(value ?? "").trim();
  return /^https:\/\//i.test(url) && /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url);
};

const decodeXml = (value: string): string => value
  .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  .replaceAll("&quot;", "\"").replaceAll("&#39;", "'");

const xmlValue = (xml: string, tag: string): string | null => {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"));
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(String(cdata?.[1] ?? plain?.[1] ?? "")).trim() || null;
};

const fetchCommunitySummary = async (steamId: string): Promise<Record<string, unknown> | null> => {
  try {
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
    const response = await fetch(`${profileUrl}/?xml=1`, {
      headers: { "Accept": "application/xml", "User-Agent": "ATX-Racing/1.0" },
    });
    if (!response.ok) return null;
    const xml = await response.text();
    return {
      steamid: steamId,
      personaname: xmlValue(xml, "steamID"),
      profileurl: profileUrl,
      avatarfull: xmlValue(xml, "avatarFull") ?? DEFAULT_STEAM_AVATAR,
    };
  } catch {
    return null;
  }
};

const hydrateSteamProfiles = async (
  supabase: ReturnType<typeof adminClient>,
  drivers: Array<Record<string, any>>,
  identities: SteamIdentity[],
): Promise<void> => {
  const pending = identities.filter((identity) =>
    !String(identity.steam_persona_name ?? "").trim() || !usableAvatarUrl(identity.steam_avatar_url)
  );
  const apiKey = Deno.env.get("STEAM_API_KEY");
  if (pending.length === 0) return;

  const summaries = new Map<string, Record<string, unknown>>();
  if (apiKey) {
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100);
      const endpoint = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
      endpoint.searchParams.set("key", apiKey);
      endpoint.searchParams.set("steamids", batch.map((identity) => identity.steam_id64).join(","));
      try {
        const response = await fetch(endpoint, { headers: { "Accept": "application/json", "User-Agent": "ATX-Racing/1.0" } });
        if (!response.ok) continue;
        const body = await response.json();
        for (const player of body?.response?.players ?? []) summaries.set(String(player.steamid), player);
      } catch (error) {
        console.warn("Steam profile synchronization failed", error instanceof Error ? error.message : "unknown error");
      }
    }
  }

  const unresolved = pending.filter((identity) => !summaries.has(identity.steam_id64));
  for (let offset = 0; offset < unresolved.length; offset += 20) {
    const batch = unresolved.slice(offset, offset + 20);
    const players = await Promise.all(batch.map((identity) => fetchCommunitySummary(identity.steam_id64)));
    players.forEach((player) => { if (player?.steamid) summaries.set(String(player.steamid), player); });
  }

  const driverById = new Map(drivers.map((driver) => [String(driver.id), driver]));
  await Promise.all(pending.map(async (identity) => {
    const player = summaries.get(identity.steam_id64);
    if (!player) return;
    const driver = driverById.get(identity.driver_id);
    const personaName = String(player.personaname ?? driver?.display_name ?? "").trim().slice(0, 64) || null;
    const avatarUrl = usableAvatarUrl(player.avatarfull) ? String(player.avatarfull) : null;
    const profileUrl = String(player.profileurl ?? "").startsWith("https://")
      ? String(player.profileurl)
      : `https://steamcommunity.com/profiles/${identity.steam_id64}`;
    if (!personaName && !avatarUrl) return;

    await supabase.from("driver_identities").update({
      steam_persona_name: personaName ?? identity.steam_persona_name,
      steam_profile_url: profileUrl,
      steam_avatar_url: avatarUrl ?? identity.steam_avatar_url,
    }).eq("driver_id", identity.driver_id);

    identity.steam_persona_name = personaName ?? identity.steam_persona_name;
    identity.steam_profile_url = profileUrl;
    identity.steam_avatar_url = avatarUrl ?? identity.steam_avatar_url;
    if (!driver) return;
    const updates: Record<string, string> = {};
    if (!driver.custom_display_name && personaName) {
      driver.display_name = personaName;
      updates.display_name = personaName;
    }
    if (!driver.custom_avatar_url && avatarUrl) {
      driver.avatar_url = avatarUrl;
      updates.avatar_url = avatarUrl;
    }
    if (Object.keys(updates).length) await supabase.from("drivers").update(updates).eq("id", identity.driver_id);
  }));
};

const eventRow = (event: unknown): Record<string, unknown> | null => {
  const row = Array.isArray(event) ? event[0] : event as Record<string, unknown> | null;
  return row ?? null;
};

const raceCategory = (event: unknown): RaceCategory => {
  const row = eventRow(event);
  const source = [row?.server_name, row?.title_fr, row?.title_en].filter(Boolean).join(" | ");
  const code = source.match(/(?:^|[^a-z0-9])(WGT|DR|OL)(?=$|[^a-z0-9])/i)?.[1]?.toUpperCase();
  if (code === "WGT" || code === "DR" || code === "OL") return code;
  if (/\b(SPRINT|ENDU|WORLD\s*GT)\b/i.test(source)) return "WGT";
  if (/\bDAILY\s+RACE\b/i.test(source)) return "DR";
  const date = String(row?.starts_at ?? "").slice(0, 10);
  if (["2026-09-09", "2026-09-11", "2026-09-13"].includes(date)) return "DR";
  return "OL";
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
type BestLap = { lap_ms: number; session_type: SessionType; at: string; car_model_name: string | null };
type SessionLaps = { FP: number | null; Q: number | null; R: number | null };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabase = adminClient();
    const requestedCategory = new URL(request.url).searchParams.get("category")?.toUpperCase();
    const category: RankingScope = requestedCategory === "WGT" || requestedCategory === "OL" || requestedCategory === "ALL" ? requestedCategory : "DR";

    // Circuit rankings are based on imported ACC timing data, not on whether a
    // driver has made their profile public. Privacy only controls profile links.
    const { data: drivers, error: driversError } = await supabase.from("drivers")
      .select("id, display_name, custom_display_name, avatar_url, custom_avatar_url, team_name, is_profile_public");
    if (driversError) throw driversError;

    const { data: identityRows, error: claimedError } = await supabase.from("driver_identities")
      .select("driver_id, steam_id64, steam_persona_name, steam_profile_url, steam_avatar_url, last_login_at");
    if (claimedError) throw claimedError;
    await hydrateSteamProfiles(supabase, drivers ?? [], (identityRows ?? []) as SteamIdentity[]);
    const identityByDriver = new Map((identityRows ?? []).map((identity) => [identity.driver_id, identity]));
    for (const driver of drivers ?? []) {
      const identity = identityByDriver.get(driver.id);
      driver.display_name = driver.custom_display_name || identity?.steam_persona_name || driver.display_name;
      driver.avatar_url = driver.custom_avatar_url || identity?.steam_avatar_url || driver.avatar_url;
    }
    const claimed = new Set((identityRows ?? []).filter((row) => row.last_login_at).map((row) => row.driver_id));
    const profileIsPublic = new Map((drivers ?? []).map((driver) => [driver.id, driver.is_profile_public === true]));
    const publicProfileId = (driverId: string): string | null =>
      claimed.has(driverId) && profileIsPublic.get(driverId) === true ? driverId : null;

    const results: Array<Record<string, unknown>> = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.from("results")
        .select("driver_id, status, finish_position, points, best_lap_ms, car_model_name, created_at, event:events!inner(id, circuit_key, circuit_name, starts_at, is_public, server_name, title_fr, title_en)")
        .eq("event.is_public", true).order("created_at", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      results.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const generalResults = results.filter((result) => category === "ALL" || raceCategory(result.event) === category);
    const wgtRawResults = generalResults.filter((result) => raceCategory(result.event) === "WGT");
    const wgtEventIds = [...new Set(wgtRawResults.map((result) => String(eventRow(result.event)?.id ?? "")).filter(Boolean))];
    let wgtRegistrations: Array<{event_id:string; driver_id:string; team_name:string|null}> = [];
    if (wgtEventIds.length) {
      const { data, error } = await supabase.from("registrations")
        .select("event_id, driver_id, team_name").in("event_id", wgtEventIds);
      if (error) throw error;
      wgtRegistrations = data ?? [];
    }
    const wgtScore = worldGTPoints(wgtRawResults.map((result) => ({
      event_id: String(eventRow(result.event)?.id ?? ""),
      driver_id: String(result.driver_id),
      status: String(result.status ?? ""),
      finish_position: result.finish_position as number | null,
      best_lap_ms: result.best_lap_ms as number | null,
    })), wgtRegistrations);
    const wgtEntryForResult = (result: Record<string, unknown>) =>
      wgtScore.driverPoints.get(String(eventRow(result.event)?.id ?? "") + "|" + String(result.driver_id));
    const pointsForResult = (result: Record<string, unknown>): number => {
      if (raceCategory(result.event) !== "WGT") return Number(result.points ?? 0);
      return wgtEntryForResult(result)?.points ?? 0;
    };

    const sessionResults: Array<Record<string, unknown>> = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.from("acc_session_results")
        .select("driver_id, best_lap_ms, car_model_name, created_at, session:acc_sessions!inner(session_type, session_date, published_at, created_at, event:events!inner(circuit_key, circuit_name, starts_at, is_public, is_official, server_name, title_fr, title_en))")
        .order("created_at", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      sessionResults.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // Any official timing file received from the collector must contribute to
    // FP/Q/R circuit records. An event can be hidden from the calendar/archive
    // without making its valid lap data disappear from the timing leaderboard.
    const rankingSessionResults = sessionResults.filter((result) => {
      const session = Array.isArray(result.session) ? result.session[0] : result.session as Record<string, unknown> | null;
      const event = Array.isArray(session?.event) ? session.event[0] : session?.event as Record<string, unknown> | null;
      return event?.is_official !== false && (category === "ALL" || raceCategory(event) === category);
    });

    const { data: ratings, error: ratingsError } = await supabase.from("driver_ratings")
      .select("driver_id, safety_class, safety_score").eq("circuit_key", "overall");
    if (ratingsError) throw ratingsError;
    const ratingByDriver = new Map((ratings ?? []).map((rating) => [rating.driver_id, rating]));

    const bestByDriverCircuit = new Map<string, BestLap>();
    const bestByDriverCircuitSession = new Map<string, BestLap>();
    const timelineByDriver = new Map<string, Array<{ at: number; circuit_key: string; lap_ms: number }>>();

    for (const result of rankingSessionResults) {
      const session = Array.isArray(result.session) ? result.session[0] : result.session as Record<string, unknown> | null;
      const event = Array.isArray(session?.event) ? session.event[0] : session?.event as Record<string, unknown> | null;
      const circuitKey = canonicalCircuitKey(event?.circuit_key ?? event?.circuit_name);
      const lap = Number(result.best_lap_ms);
      const sessionType = normaliseSessionType(session?.session_type);
      if (!circuitKey || !sessionType || !Number.isFinite(lap) || lap <= 0) continue;

      const achievedAt = String(session?.published_at ?? session?.created_at ?? result.created_at ?? "");
      const baseKey = `${result.driver_id}|${circuitKey}`;
      const sessionKey = `${baseKey}|${sessionType}`;
      const carModelName = String(result.car_model_name ?? "").trim() || null;
      const best: BestLap = { lap_ms: lap, session_type: sessionType, at: achievedAt, car_model_name: carModelName };

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
      const driverResults = generalResults.filter((result) => result.driver_id === driver.id);
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
      const carCounts = new Map<string, number>();
      [...driverResults, ...rankingSessionResults.filter((result) => result.driver_id === driver.id)].forEach((result) => {
        const car = String(result.car_model_name ?? "").trim();
        if (car) carCounts.set(car, (carCounts.get(car) ?? 0) + 1);
      });
      const carsUsed = [...carCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([car]) => car);

      return {
        driver_id: driver.id,
        profile_id: publicProfileId(driver.id),
        display_name: driver.display_name,
        avatar_url: driver.avatar_url,
        team_name: driver.team_name,
        primary_car: carsUsed[0] ?? null,
        cars_used: carsUsed,
        races: driverResults.length,
        wins: driverResults.filter((result) => result.status === "classified" && (raceCategory(result.event) === "WGT" ? wgtEntryForResult(result)?.finish_position === 1 : result.finish_position === 1)).length,
        podiums: driverResults.filter((result) => result.status === "classified" && (raceCategory(result.event) === "WGT" ? (wgtEntryForResult(result)?.finish_position ?? 999) <= 3 : Number(result.finish_position) <= 3)).length,
        points: driverResults.reduce((total, result) => total + pointsForResult(result), 0),
        points_per_race: driverResults.length ? driverResults.reduce((total, result) => total + pointsForResult(result), 0) / driverResults.length : 0,
        circuits: circuitPaces.length,
        performance_score: paceScore === null ? null : Number(paceScore.toFixed(3)),
        performance_class: performanceClass(paceScore),
        progression: trend === null ? null : Number(trend.toFixed(3)),
        safety_class: safetyClass(safety?.safety_score == null ? null : Number(safety.safety_score)),
        safety_score: safety?.safety_score ?? null,
      };
    }).filter((row) => row.circuits > 0 || row.races > 0)
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
          profile_id: publicProfileId(driver.id),
          display_name: driver.display_name,
          avatar_url: driver.avatar_url,
          best_lap_ms: best.lap_ms,
          session_type: best.session_type,
          car_model_name: best.car_model_name,
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
    if (category === "WGT") {
      // One line per racing team; a two-driver crew contributes its points once.
      const paceByDriver = new Map(rows.map((driver) => [driver.driver_id, driver.performance_score]));
      for (const entry of wgtScore.entries) {
        const key = entry.team_name.toLocaleLowerCase("fr");
        const team = teamGroups.get(key) ?? {
          team_name: entry.team_name, points: 0, races: 0, wins: 0,
          podiums: 0, member_ids: new Set<string>(), pace_scores: [],
        };
        team.points += entry.points;
        team.races += 1;
        if (entry.finish_position === 1) team.wins += 1;
        if (entry.finish_position !== null && entry.finish_position <= 3) team.podiums += 1;
        for (const driverId of entry.driver_ids) {
          team.member_ids.add(driverId);
          const pace = paceByDriver.get(driverId);
          if (pace !== null && pace !== undefined) team.pace_scores.push(Number(pace));
        }
        teamGroups.set(key, team);
      }
    } else for (const driver of rows) {
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

    return json({ generated_at: new Date().toISOString(), category, drivers: rows, circuits: circuitRankings, teams });
  } catch (error) {
    console.error("Leaderboard failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
});
