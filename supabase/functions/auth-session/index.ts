import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders,
  hmacHex, jsonResponse, randomToken,
} from "../_shared/auth.ts";

const publicDriver = async (driverId: string) => {
  const supabase = adminClient();
  const { data: driver, error } = await supabase.from("drivers")
    .select("id, profile_slug, display_name, avatar_url, country_code, bio_fr, bio_en, created_at, updated_at")
    .eq("id", driverId).single();
  if (error) throw error;
  const { data: ratings, error: ratingsError } = await supabase.from("driver_ratings")
    .select("circuit_key, performance_class, performance_score, safety_class, safety_score, calculated_at")
    .eq("driver_id", driverId).order("calculated_at", { ascending: false });
  if (ratingsError) throw ratingsError;

  const { data: results, error: resultsError } = await supabase.from("results")
    .select("status, finish_position, points, laps_completed, best_lap_ms, car_model_name, created_at, event:events(slug, title_fr, title_en, circuit_name, starts_at)")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });
  if (resultsError) throw resultsError;

  const allResults = results ?? [];
  const stats = allResults.reduce((summary, result) => ({
    races: summary.races + 1,
    podiums: summary.podiums + (
      result.finish_position && result.finish_position <= 3 && result.status === "classified" ? 1 : 0
    ),
    points: summary.points + Number(result.points ?? 0),
  }), { races: 0, podiums: 0, points: 0 });

  return { ...driver, ratings, results: allResults, stats };
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
