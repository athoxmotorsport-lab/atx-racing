import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders, hmacHex, jsonResponse,
} from "../_shared/auth.ts";

const allowedTypes = new Set(["daily_race", "sprint", "endurance", "championship", "special_event"]);
const allowedImages = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
]);

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";

const slugPart = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "event";

const requireAdmin = async (request: Request): Promise<string> => {
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
  return session.driver_id;
};

Deno.serve(async (request) => {
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
    if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);
    await requireAdmin(request);

    const body = await request.json().catch(() => ({}));
    const titleFr = cleanText(body.titleFr, 96);
    const titleEn = cleanText(body.titleEn, 96);
    const circuit = cleanText(body.circuit, 64);
    const eventType = cleanText(body.eventType, 32);
    const durationMinutes = Number(body.durationMinutes);
    const maxDrivers = Number(body.maxDrivers);
    const startsAt = new Date(String(body.startsAt ?? ""));
    const simgridUrl = new URL(String(body.simgridUrl ?? ""));
    const imageType = cleanText(body.imageType, 32);
    const extension = allowedImages.get(imageType);
    const imageData = typeof body.imageData === "string" ? body.imageData : "";
    if (!titleFr || !titleEn || !circuit || !allowedTypes.has(eventType) || !extension || !imageData) {
      return jsonResponse(request, { error: "invalid_fields" }, 400);
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 ||
      !Number.isInteger(maxDrivers) || maxDrivers < 1 || maxDrivers > 100 || Number.isNaN(startsAt.getTime())) {
      return jsonResponse(request, { error: "invalid_fields" }, 400);
    }
    if (!/(^|\.)thesimgrid\.com$/i.test(simgridUrl.hostname) || simgridUrl.protocol !== "https:") {
      return jsonResponse(request, { error: "invalid_simgrid_url" }, 400);
    }
    const bytes = Uint8Array.from(atob(imageData), (character) => character.charCodeAt(0));
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return jsonResponse(request, { error: "invalid_image" }, 400);

    const date = startsAt.toISOString().slice(0, 10);
    const suffix = crypto.randomUUID().slice(0, 8);
    const slug = `${date}-${slugPart(circuit)}-${slugPart(titleFr)}-${suffix}`.slice(0, 120).replace(/-+$/g, "");
    const circuitKey = circuit.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 64);
    const objectPath = `${date}/${slug}.${extension}`;
    const supabase = adminClient();
    const { error: uploadError } = await supabase.storage.from("event-posters").upload(objectPath, bytes, {
      contentType: imageType, cacheControl: "31536000", upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: publicImage } = supabase.storage.from("event-posters").getPublicUrl(objectPath);
    const { data: event, error: eventError } = await supabase.from("events").insert({
      slug, event_type: eventType, status: "registration_open", title_fr: titleFr, title_en: titleEn,
      circuit_name: circuit, circuit_key: circuitKey, starts_at: startsAt.toISOString(), timezone: "Europe/Brussels",
      duration_minutes: durationMinutes, max_drivers: maxDrivers, simgrid_url: simgridUrl.toString(),
      image_url: publicImage.publicUrl, is_public: true, is_official: true,
    }).select("slug, title_fr, starts_at, image_url").single();
    if (eventError) {
      await supabase.storage.from("event-posters").remove([objectPath]);
      throw eventError;
    }
    return jsonResponse(request, { event }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORIGIN_NOT_ALLOWED") return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    if (message === "UNAUTHORIZED") return jsonResponse(request, { error: "unauthorized" }, 401);
    if (message === "FORBIDDEN") return jsonResponse(request, { error: "forbidden" }, 403);
    console.error("Event publication failed", message || "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
