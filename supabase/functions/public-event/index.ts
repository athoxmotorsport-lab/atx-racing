import { adminClient } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://athoxmotorsport-lab.github.io",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  if (!slug) {
    const supabase = adminClient();
    const { data: events, error } = await supabase.from("events")
      .select("id, slug, event_type, status, title_fr, title_en, circuit_name, starts_at, duration_minutes, max_drivers, simgrid_url, image_url")
      .eq("is_public", true).order("starts_at", { ascending: false }).limit(100);
    if (error) return json({ error: "server_error" }, 500);
    const ids = (events ?? []).map((event) => event.id);
    const resultRows: Array<{ event_id: string }> = [];
    if (ids.length) {
      for (let from = 0; from < 5000; from += 1000) {
        const { data, error: resultError } = await supabase.from("results").select("event_id")
          .in("event_id", ids).range(from, from + 999);
        if (resultError) return json({ error: "server_error" }, 500);
        resultRows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
    }
    const resultCounts = new Map<string, number>();
    for (const row of resultRows ?? []) resultCounts.set(row.event_id, (resultCounts.get(row.event_id) ?? 0) + 1);
    const archiveStart = Date.parse("2026-09-08T22:00:00Z");
    const now = Date.now();
    const publicEvents = (events ?? []).map(({ id, ...event }) => ({ ...event, result_count: resultCounts.get(id) ?? 0 }));
    const calendar = publicEvents.filter((event) => event.image_url && event.simgrid_url).slice(0, 24);
    const archives = publicEvents.filter((event) => Date.parse(event.starts_at) >= archiveStart && Date.parse(event.starts_at) <= now && event.result_count > 0);
    return json({ events: calendar, archives });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "invalid_slug" }, 400);

  const supabase = adminClient();
  const { data: event, error } = await supabase.from("events")
    .select("id, slug, title_fr, title_en, circuit_name, starts_at, duration_minutes, server_name, is_official")
    .eq("slug", slug).eq("is_public", true).maybeSingle();
  if (error) return json({ error: "server_error" }, 500);
  if (!event) return json({ error: "event_not_found" }, 404);

  const { data: results, error: resultsError } = await supabase.from("results")
    .select("driver_id, finish_position, status, points, laps_completed, best_lap_ms, car_model_name, race_number, driver:drivers(display_name, avatar_url)")
    .eq("event_id", event.id)
    .order("finish_position", { ascending: true, nullsFirst: false });
  if (resultsError) return json({ error: "server_error" }, 500);
  const { data: honours, error: honoursError } = await supabase.from("event_honours")
    .select("driver_id, award_type, best_lap_ms, penalty_count, clean_laps").eq("event_id", event.id);
  if (honoursError) return json({ error: "server_error" }, 500);
  const driverById = new Map((results ?? []).map((result) => {
    const driver = Array.isArray(result.driver) ? result.driver[0] : result.driver;
    return [result.driver_id, driver];
  }));
  return json({ event, results: results ?? [], honours: (honours ?? []).map((honour) => ({ ...honour, driver: driverById.get(honour.driver_id) ?? null })) });
});
