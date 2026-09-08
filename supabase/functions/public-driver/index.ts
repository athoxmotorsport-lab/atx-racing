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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const driverId = new URL(request.url).searchParams.get("driver") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(driverId)) {
    return json({ error: "invalid_driver" }, 400);
  }
  try {
    const supabase = adminClient();
    const { data: identity } = await supabase.from("driver_identities").select("last_login_at")
      .eq("driver_id", driverId).not("last_login_at", "is", null).maybeSingle();
    if (!identity) return json({ error: "profile_not_claimed" }, 404);
    const { data: driver, error } = await supabase.from("drivers")
      .select("id, display_name, avatar_url, country_code, team_name, bio_fr, bio_en, twitch_url, tiktok_url, youtube_url, website_url")
      .eq("id", driverId).eq("is_profile_public", true).maybeSingle();
    if (error) throw error;
    if (!driver) return json({ error: "profile_not_found" }, 404);
    const { data: ratings, error: ratingsError } = await supabase.from("driver_ratings")
      .select("circuit_key, performance_class, performance_score, safety_class, safety_score, calculated_at")
      .eq("driver_id", driverId).order("calculated_at", { ascending: false });
    if (ratingsError) throw ratingsError;
    const { data: results, error: resultsError } = await supabase.from("results")
      .select("status, finish_position, points, laps_completed, best_lap_ms, car_model_name, created_at, event:events!inner(slug, title_fr, title_en, circuit_name, circuit_key, starts_at, is_public)")
      .eq("driver_id", driverId).eq("event.is_public", true).order("created_at", { ascending: false });
    if (resultsError) throw resultsError;
    const allResults = results ?? [];
    const stats = allResults.reduce((summary, result) => ({
      races: summary.races + 1,
      podiums: summary.podiums + (result.status === "classified" && Number(result.finish_position) <= 3 ? 1 : 0),
      points: summary.points + Number(result.points ?? 0),
    }), { races: 0, podiums: 0, points: 0 });
    return json({ driver: { ...driver, ratings: ratings ?? [], results: allResults, stats } });
  } catch (error) {
    console.error("Public driver failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
});
