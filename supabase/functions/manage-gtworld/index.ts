import { adminClient, assertAllowedOrigin, bearerToken, corsHeaders, hmacHex, jsonResponse } from "../_shared/auth.ts";

const clean = (value: unknown, max = 96): string => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
const isGtWorld = (event: {title_fr?:string|null;title_en?:string|null;server_name?:string|null;event_type?:string|null}): boolean => /^(SPRINT|ENDU)\b/i.test(String(event.title_fr ?? "").trim()) || /^(SPRINT|ENDU)\b/i.test(String(event.title_en ?? "").trim()) || ((event.event_type === "sprint" || event.event_type === "endurance") && /(?:^|[^a-z0-9])WGT(?=$|[^a-z0-9])|WORLD\s*GT/i.test([event.server_name,event.title_fr,event.title_en].join(" | ")));

const requireAdmin = async (request: Request): Promise<void> => {
  const token = bearerToken(request);
  if (!token) throw new Error("UNAUTHORIZED");
  const supabase = adminClient();
  const { data: session } = await supabase.from("auth_sessions")
    .select("driver_id").eq("token_hash", await hmacHex(token)).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!session) throw new Error("UNAUTHORIZED");
  const { data: role } = await supabase.from("driver_roles").select("role")
    .eq("driver_id", session.driver_id).eq("role", "admin").maybeSingle();
  if (!role) throw new Error("FORBIDDEN");
};

Deno.serve(async (request) => {
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
    if (!["GET", "PATCH"].includes(request.method)) return jsonResponse(request, { error: "method_not_allowed" }, 405);
    await requireAdmin(request);
    const supabase = adminClient();

    const { data: allEvents, error: eventError } = await supabase.from("events")
      .select("id, slug, title_fr, title_en, server_name, event_type, circuit_name, starts_at, status")
      .order("starts_at", { ascending: false });
    if (eventError) throw eventError;
    const events = (allEvents ?? []).filter((event) => isGtWorld(event));

    if (request.method === "GET") {
      const ids = events.map((event) => event.id);
      if (!ids.length) return jsonResponse(request, { events: [] });
      const { data: results, error: resultError } = await supabase.from("results")
        .select("event_id, driver_id, finish_position, best_lap_ms, driver:drivers!inner(display_name)")
        .in("event_id", ids).order("finish_position", { ascending: true });
      if (resultError) throw resultError;
      const { data: registrations, error: regError } = await supabase.from("registrations")
        .select("event_id, driver_id, team_name").in("event_id", ids);
      if (regError) throw regError;
      const teamMap = new Map((registrations ?? []).map((row) => [`${row.event_id}|${row.driver_id}`, row.team_name ?? ""]));
      return jsonResponse(request, {
        events: events.map((event) => ({
          ...event,
          drivers: (results ?? []).filter((row) => row.event_id === event.id).map((row) => {
            const driver = Array.isArray(row.driver) ? row.driver[0] : row.driver;
            return {
              driver_id: row.driver_id,
              display_name: driver?.display_name ?? "Pilote",
              finish_position: row.finish_position,
              best_lap_ms: row.best_lap_ms,
              team_name: teamMap.get(`${event.id}|${row.driver_id}`) || "",
            };
          }),
        })),
      });
    }

    const body = await request.json().catch(() => ({}));
    const slug = clean(body.eventSlug, 120);
    const event = events.find((item) => item.slug === slug);
    if (!event) return jsonResponse(request, { error: "event_not_found" }, 404);
    if (!Array.isArray(body.assignments)) return jsonResponse(request, { error: "invalid_assignments" }, 400);

    for (const assignment of body.assignments) {
      const driverId = clean(assignment?.driverId, 64);
      const teamName = clean(assignment?.teamName, 96);
      if (!/^[0-9a-f-]{36}$/i.test(driverId)) continue;
      if (!teamName) {
        const { error } = await supabase.from("registrations")
          .update({ team_name: null }).eq("event_id", event.id).eq("driver_id", driverId);
        if (error) throw error;
        continue;
      }
      const { error } = await supabase.from("registrations").upsert({
        event_id: event.id,
        driver_id: driverId,
        status: "confirmed",
        team_name: teamName,
        external_source: "atx-gtworld-admin",
        external_reference: `${event.slug}:${driverId}`,
      }, { onConflict: "event_id,driver_id" });
      if (error) throw error;
    }

    return jsonResponse(request, { ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORIGIN_NOT_ALLOWED") return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    if (message === "UNAUTHORIZED") return jsonResponse(request, { error: "unauthorized" }, 401);
    if (message === "FORBIDDEN") return jsonResponse(request, { error: "forbidden" }, 403);
    console.error("WorldGT management failed", message || "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
