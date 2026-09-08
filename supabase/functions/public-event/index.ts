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
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: "invalid_slug" }, 400);

  const supabase = adminClient();
  const { data: event, error } = await supabase.from("events")
    .select("id, slug, title_fr, title_en, circuit_name, starts_at, duration_minutes, server_name, is_official")
    .eq("slug", slug).eq("is_public", true).maybeSingle();
  if (error) return json({ error: "server_error" }, 500);
  if (!event) return json({ error: "event_not_found" }, 404);

  const { data: results, error: resultsError } = await supabase.from("results")
    .select("finish_position, status, points, laps_completed, best_lap_ms, car_model_name, race_number, driver:drivers(display_name, avatar_url)")
    .eq("event_id", event.id)
    .order("finish_position", { ascending: true, nullsFirst: false });
  if (resultsError) return json({ error: "server_error" }, 500);
  return json({ event, results: results ?? [] });
});
