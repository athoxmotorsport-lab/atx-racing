import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders,
  hmacHex, jsonResponse, randomToken,
} from "../_shared/auth.ts";

const publicDriver = async (driverId: string) => {
  const supabase = adminClient();
  const { data: driver, error } = await supabase.from("drivers")
    .select("id, profile_slug, display_name, avatar_url, country_code, team_name, bio_fr, bio_en, twitch_url, tiktok_url, youtube_url, website_url, created_at, updated_at")
    .eq("id", driverId).single();
  if (error) throw error;
  const { data: ratings, error: ratingsError } = await supabase.from("driver_ratings")
    .select("circuit_key, performance_class, performance_score, safety_class, safety_score, calculated_at")
    .eq("driver_id", driverId).order("calculated_at", { ascending: false });
  if (ratingsError) throw ratingsError;

  const { data: results, error: resultsError } = await supabase.from("results")
    .select("status, finish_position, points, laps_completed, best_lap_ms, car_model_name, created_at, event:events(slug, title_fr, title_en, circuit_name, circuit_key, starts_at)")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });
  if (resultsError) throw resultsError;

  const allResults = results ?? [];
  const stats = allResults.reduce((summary, result) => ({
    races: summary.races + 1,
    wins: summary.wins + (
      result.finish_position === 1 && result.status === "classified" ? 1 : 0
    ),
    podiums: summary.podiums + (
      result.finish_position && result.finish_position <= 3 && result.status === "classified" ? 1 : 0
    ),
    points: summary.points + Number(result.points ?? 0),
  }), { races: 0, wins: 0, podiums: 0, points: 0 });

  const sortedResults = [...allResults].sort((first, second) => {
    const firstEvent = Array.isArray(first.event) ? first.event[0] : first.event;
    const secondEvent = Array.isArray(second.event) ? second.event[0] : second.event;
    return Date.parse(secondEvent?.starts_at ?? "") - Date.parse(firstEvent?.starts_at ?? "");
  });

  const { data: roleRows, error: rolesError } = await supabase.from("driver_roles")
    .select("role").eq("driver_id", driverId);
  if (rolesError) throw rolesError;

  const { data: lapRows, error: lapsError } = await supabase.from("results")
    .select("driver_id, best_lap_ms, event:events(circuit_key, circuit_name)")
    .not("best_lap_ms", "is", null).gt("best_lap_ms", 0);
  if (lapsError) throw lapsError;

  const references = new Map<string, { circuit_key: string; circuit_name: string; alien_best_lap_ms: number }>();
  for (const row of lapRows ?? []) {
    const event = Array.isArray(row.event) ? row.event[0] : row.event;
    const lap = Number(row.best_lap_ms);
    if (!event?.circuit_key || !Number.isFinite(lap) || lap <= 0) continue;
    const current = references.get(event.circuit_key);
    if (!current || lap < current.alien_best_lap_ms) {
      references.set(event.circuit_key, {
        circuit_key: event.circuit_key,
        circuit_name: event.circuit_name,
        alien_best_lap_ms: lap,
      });
    }
  }

  const personal = new Map<string, number>();
  for (const result of allResults) {
    const event = Array.isArray(result.event) ? result.event[0] : result.event;
    const lap = Number(result.best_lap_ms);
    if (!event?.circuit_key || !Number.isFinite(lap) || lap <= 0) continue;
    const current = personal.get(event.circuit_key);
    if (!current || lap < current) personal.set(event.circuit_key, lap);
  }
  const ratingByCircuit = new Map((ratings ?? []).map((rating) => [rating.circuit_key, rating]));
  const circuits = [...references.values()].map((reference) => {
    const personalBest = personal.get(reference.circuit_key) ?? null;
    const rating = ratingByCircuit.get(reference.circuit_key);
    return {
      ...reference,
      personal_best_lap_ms: personalBest,
      pace_percent: personalBest ? personalBest / reference.alien_best_lap_ms * 100 : null,
      performance_class: rating?.performance_class ?? null,
      safety_class: rating?.safety_class ?? null,
    };
  });

  const { data: honours, error: honoursError } = await supabase.from("event_honours")
    .select("award_type, best_lap_ms, penalty_count, clean_laps, event_slug, circuit_name, starts_at")
    .eq("driver_id", driverId).order("starts_at", { ascending: false });
  if (honoursError) throw honoursError;

  return { ...driver, roles: (roleRows ?? []).map((row) => row.role), ratings, circuits, results: sortedResults, awards: honours ?? [], stats };
};

const exchangeCode = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(code)) {
    return jsonResponse(request, { error: "invalid_exchange_code" }, 400);
  }
  const supabase = adminClient();
  const { data: driverId, error } = await supabase.rpc("consume_auth_exchange_code", {
    p_code_hash: await hmacHex(code),
  });
  if (error || !driverId) return jsonResponse(request, { error: "expired_exchange_code" }, 401);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: sessionError } = await supabase.from("auth_sessions").insert({
    driver_id: driverId,
    token_hash: await hmacHex(token),
    expires_at: expiresAt,
  });
  if (sessionError) throw sessionError;
  return jsonResponse(request, {
    access_token: token,
    token_type: "Bearer",
    expires_at: expiresAt,
    driver: await publicDriver(driverId),
  });
};

const readSession = async (request: Request): Promise<Response> => {
  const token = bearerToken(request);
  if (!token) return jsonResponse(request, { error: "missing_session" }, 401);
  const supabase = adminClient();
  const { data: session, error } = await supabase.from("auth_sessions")
    .select("id, driver_id, expires_at")
    .eq("token_hash", await hmacHex(token)).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !session) return jsonResponse(request, { error: "invalid_session" }, 401);
  await supabase.from("auth_sessions")
    .update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  return jsonResponse(request, {
    expires_at: session.expires_at,
    driver: await publicDriver(session.driver_id),
  });
};

Deno.serve(async (request) => {
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
    }
    if (request.method === "POST") return await exchangeCode(request);
    if (request.method === "GET") return await readSession(request);
    return jsonResponse(request, { error: "method_not_allowed" }, 405);
  } catch (error) {
    if (error instanceof Error && error.message === "ORIGIN_NOT_ALLOWED") {
      return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    }
    console.error("Session request failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
