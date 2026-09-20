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

const pointsByPosition = new Map([[1,50],[2,36],[3,30],[4,24],[5,20],[6,16],[7,12],[8,8],[9,4],[10,2]]);
const formatFromTitle = (title: unknown): "SPRINT" | "ENDU" | null => {
  const match = String(title ?? "").trim().toUpperCase().match(/^(SPRINT|ENDU)\b/);
  return match ? match[1] as "SPRINT" | "ENDU" : null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabase = adminClient();
    const { data: events, error: eventsError } = await supabase.from("events")
      .select("id, slug, title_fr, title_en, circuit_name, starts_at, status, is_public, server_name, event_type")
      .eq("is_public", true).order("starts_at", { ascending: true });
    if (eventsError) throw eventsError;

    const gtEvents = (events ?? []).flatMap((event) => {
      const labelledWorldGT = /(?:^|[^a-z0-9])WGT(?=$|[^a-z0-9])|WORLD\s*GT/i.test([event.server_name, event.title_fr, event.title_en].join(" | "));
      const format = formatFromTitle(event.title_fr) ?? formatFromTitle(event.title_en)
        ?? (labelledWorldGT && event.event_type === "sprint" ? "SPRINT" : labelledWorldGT && event.event_type === "endurance" ? "ENDU" : null);
      return format ? [{ ...event, format }] : [];
    });
    const ids = gtEvents.map((event) => event.id);
    if (!ids.length) return json({ season: "WorldGT Saison 1", points_system: { positions: Object.fromEntries(pointsByPosition), fastest_lap: 2 }, standings: [], events: [] });

    const { data: results, error: resultsError } = await supabase.from("results")
      .select("event_id, driver_id, status, finish_position, best_lap_ms, driver:drivers!inner(display_name)")
      .in("event_id", ids);
    if (resultsError) throw resultsError;

    const { data: registrations, error: registrationsError } = await supabase.from("registrations")
      .select("event_id, driver_id, team_name").in("event_id", ids);
    if (registrationsError) throw registrationsError;
    const teamByDriverEvent = new Map((registrations ?? []).map((row) => [`${row.event_id}|${row.driver_id}`, String(row.team_name ?? "").trim()]));

    const championship = new Map<string, { team_name:string; points:number; events:number; wins:number; podiums:number; sprint:number; endurance:number; fastest_laps:number }>();
    const eventPayload = gtEvents.map((event) => {
      const grouped = new Map<string, { team_name:string; finish_position:number|null; best_lap_ms:number|null; members:Set<string> }>();
      for (const result of (results ?? []).filter((row) => row.event_id === event.id && row.status !== "dns" && row.status !== "dsq")) {
        const teamName = teamByDriverEvent.get(`${event.id}|${result.driver_id}`) || "";
        if (!teamName) continue;
        const key = teamName.toLocaleLowerCase("fr");
        const current = grouped.get(key) ?? { team_name: teamName, finish_position: null, best_lap_ms: null, members: new Set<string>() };
        const pos = Number(result.finish_position);
        if (Number.isFinite(pos) && pos > 0 && (current.finish_position === null || pos < current.finish_position)) current.finish_position = pos;
        const lap = Number(result.best_lap_ms);
        if (Number.isFinite(lap) && lap > 0 && (current.best_lap_ms === null || lap < current.best_lap_ms)) current.best_lap_ms = lap;
        const driver = Array.isArray(result.driver) ? result.driver[0] : result.driver;
        if (driver?.display_name) current.members.add(String(driver.display_name));
        grouped.set(key, current);
      }

      const entries = [...grouped.values()];
      const fastest = entries.map((entry) => entry.best_lap_ms).filter((lap): lap is number => lap !== null).sort((a,b)=>a-b)[0] ?? null;
      const classified = entries.map((entry) => {
        const base = entry.finish_position ? pointsByPosition.get(entry.finish_position) ?? 0 : 0;
        const fastestBonus = fastest !== null && entry.best_lap_ms === fastest ? 2 : 0;
        const points = base + fastestBonus;
        const key = entry.team_name.toLocaleLowerCase("fr");
        const total = championship.get(key) ?? { team_name: entry.team_name, points:0, events:0, wins:0, podiums:0, sprint:0, endurance:0, fastest_laps:0 };
        total.points += points;
        total.events += 1;
        if (entry.finish_position === 1) total.wins += 1;
        if (entry.finish_position && entry.finish_position <= 3) total.podiums += 1;
        if (event.format === "SPRINT") total.sprint += 1; else total.endurance += 1;
        if (fastestBonus) total.fastest_laps += 1;
        championship.set(key, total);
        return { team_name: entry.team_name, finish_position: entry.finish_position, best_lap_ms: entry.best_lap_ms, fastest_lap_bonus: fastestBonus, points, members: [...entry.members].sort() };
      }).sort((a,b) => (a.finish_position ?? 999) - (b.finish_position ?? 999) || a.team_name.localeCompare(b.team_name));

      return {
        event_id: event.id, slug: event.slug, title: event.title_fr, circuit_name: event.circuit_name,
        starts_at: event.starts_at, status: event.status, format: event.format, teams: classified,
      };
    });

    const standings = [...championship.values()]
      .sort((a,b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.team_name.localeCompare(b.team_name))
      .map((team, index) => ({ rank: index + 1, ...team }));

    return json({
      generated_at: new Date().toISOString(),
      season: "WorldGT Saison 1",
      points_system: { positions: Object.fromEntries(pointsByPosition), fastest_lap: 2 },
      standings,
      events: eventPayload,
    });
  } catch (error) {
    console.error("WorldGT leaderboard failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
});
