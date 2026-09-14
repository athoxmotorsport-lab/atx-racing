import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders, hmacHex, jsonResponse,
} from "../_shared/auth.ts";

const allowedTypes = new Set(["daily_race", "sprint", "endurance", "championship", "special_event"]);
const allowedImages = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
]);

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";

type ScheduleItem = { key: string; labelFr: string; labelEn: string; start: string; end: string };
const cleanSchedule = (value: unknown): ScheduleItem[] | null => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const allowedKeys = new Set(["practice_1", "practice_2", "briefing", "qualifying", "race"]);
  const items = value.map((item): ScheduleItem => ({
    key: cleanText(item?.key, 24), labelFr: cleanText(item?.labelFr, 64), labelEn: cleanText(item?.labelEn, 64),
    start: cleanText(item?.start, 5), end: cleanText(item?.end, 5),
  }));
  if (items.some((item) => !allowedKeys.has(item.key) || !item.labelFr || !item.labelEn ||
    !timePattern.test(item.start) || !timePattern.test(item.end))) return null;
  return items;
};

const slugPart = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "event";

const parseBrusselsLocal = (value: unknown): Date => {
  const raw = String(value ?? "").trim();
  if (/Z$|[+-]\d{2}:\d{2}$/.test(raw)) return new Date(raw);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return new Date(raw);
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - shown;
  }
  return new Date(guess);
};

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
    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return jsonResponse(request, { error: "method_not_allowed" }, 405);
    await requireAdmin(request);
    const supabase = adminClient();

    if (request.method === "GET") {
      const { data, error } = await supabase.from("events")
        .select("id, slug, event_type, status, title_fr, title_en, circuit_name, starts_at, duration_minutes, max_drivers, simgrid_url, image_url, car_class, schedule_timezone_label, event_schedule, mandatory_pit_stop, mandatory_tyre_change, mandatory_refuelling, fixed_refuelling_seconds, time_multiplier, server_name, is_public")
        .order("starts_at", { ascending: false }).limit(150);
      if (error) throw error;
      return jsonResponse(request, { events: data ?? [] });
    }

    const body = await request.json().catch(() => ({}));
    const requestedSlug = cleanText(body.slug, 120);

    if (request.method === "DELETE") {
      if (!requestedSlug) return jsonResponse(request, { error: "invalid_slug" }, 400);
      const { data: event, error } = await supabase.from("events")
        .update({ is_public: false, status: "cancelled" }).eq("slug", requestedSlug)
        .select("slug, title_fr, starts_at, is_public, status").maybeSingle();
      if (error) throw error;
      if (!event) return jsonResponse(request, { error: "event_not_found" }, 404);
      return jsonResponse(request, { event });
    }

    const titleFr = cleanText(body.titleFr, 96);
    const titleEn = cleanText(body.titleEn, 96);
    const circuit = cleanText(body.circuit, 64);
    const eventType = cleanText(body.eventType, 32);
    const durationMinutes = Number(body.durationMinutes);
    const maxDrivers = Number(body.maxDrivers);
    const carClass = cleanText(body.carClass, 32);
    const timezoneLabel = cleanText(body.timezoneLabel, 32);
    const schedule = cleanSchedule(body.schedule);
    const mandatoryPitStop = body.mandatoryPitStop === true;
    const mandatoryTyreChange = body.mandatoryTyreChange === true;
    const mandatoryRefuelling = body.mandatoryRefuelling === true;
    const fixedRefuellingSeconds = body.fixedRefuellingSeconds === null || body.fixedRefuellingSeconds === ""
      ? null
      : Number(body.fixedRefuellingSeconds);
    const timeMultiplier = Number(body.timeMultiplier);
    const serverName = cleanText(body.serverName, 120);
    const startsAt = parseBrusselsLocal(body.startsAt);
    let simgridUrl: URL;
    try { simgridUrl = new URL(String(body.simgridUrl ?? "")); } catch { return jsonResponse(request, { error: "invalid_simgrid_url" }, 400); }

    const imageType = cleanText(body.imageType, 32);
    const extension = imageType ? allowedImages.get(imageType) : undefined;
    const imageData = typeof body.imageData === "string" ? body.imageData : "";
    const isEdit = request.method === "PATCH";

    if (!titleFr || !titleEn || !circuit || !carClass || !timezoneLabel || !schedule || !allowedTypes.has(eventType) ||
      (!isEdit && (!extension || !imageData)) || (imageData && !extension)) {
      return jsonResponse(request, { error: "invalid_fields" }, 400);
    }
    if (isEdit && !requestedSlug) return jsonResponse(request, { error: "invalid_slug" }, 400);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440 ||
      !Number.isInteger(maxDrivers) || maxDrivers < 1 || maxDrivers > 100 || Number.isNaN(startsAt.getTime()) ||
      (fixedRefuellingSeconds !== null && (!Number.isInteger(fixedRefuellingSeconds) || fixedRefuellingSeconds < 0)) ||
      !Number.isFinite(timeMultiplier) || timeMultiplier < 1 || timeMultiplier > 24) {
      return jsonResponse(request, { error: "invalid_fields" }, 400);
    }
    if (!/(^|\.)thesimgrid\.com$/i.test(simgridUrl.hostname) || simgridUrl.protocol !== "https:") {
      return jsonResponse(request, { error: "invalid_simgrid_url" }, 400);
    }

    let publicImageUrl: string | null = null;
    if (imageData && extension) {
      const bytes = Uint8Array.from(atob(imageData), (character) => character.charCodeAt(0));
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) return jsonResponse(request, { error: "invalid_image" }, 400);
      const date = startsAt.toISOString().slice(0, 10);
      const objectPath = `${date}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("event-posters").upload(objectPath, bytes, {
        contentType: imageType, cacheControl: "31536000", upsert: false,
      });
      if (uploadError) throw uploadError;
      publicImageUrl = supabase.storage.from("event-posters").getPublicUrl(objectPath).data.publicUrl;
    }

    const circuitKey = circuit.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 64);
    const values: Record<string, unknown> = {
      event_type: eventType, status: "registration_open", title_fr: titleFr, title_en: titleEn,
      circuit_name: circuit, circuit_key: circuitKey, starts_at: startsAt.toISOString(), timezone: "Europe/Brussels",
      duration_minutes: durationMinutes, max_drivers: maxDrivers, simgrid_url: simgridUrl.toString(),
      car_class: carClass, schedule_timezone_label: timezoneLabel, event_schedule: schedule,
      mandatory_pit_stop: mandatoryPitStop, mandatory_tyre_change: mandatoryTyreChange,
      mandatory_refuelling: mandatoryRefuelling, fixed_refuelling_seconds: fixedRefuellingSeconds,
      time_multiplier: timeMultiplier, server_name: serverName || null, is_public: true, is_official: true,
    };
    if (publicImageUrl) values.image_url = publicImageUrl;

    if (isEdit) {
      const { data: event, error } = await supabase.from("events").update(values).eq("slug", requestedSlug)
        .select("slug, title_fr, starts_at, image_url, is_public").maybeSingle();
      if (error) throw error;
      if (!event) return jsonResponse(request, { error: "event_not_found" }, 404);
      return jsonResponse(request, { event });
    }

    const date = startsAt.toISOString().slice(0, 10);
    const suffix = crypto.randomUUID().slice(0, 8);
    const slug = `${date}-${slugPart(circuit)}-${slugPart(titleFr)}-${suffix}`.slice(0, 120).replace(/-+$/g, "");
    const { data: event, error: eventError } = await supabase.from("events").insert({ ...values, slug })
      .select("slug, title_fr, starts_at, image_url").single();
    if (eventError) throw eventError;
    return jsonResponse(request, { event }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORIGIN_NOT_ALLOWED") return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    if (message === "UNAUTHORIZED") return jsonResponse(request, { error: "unauthorized" }, 401);
    if (message === "FORBIDDEN") return jsonResponse(request, { error: "forbidden" }, 403);
    console.error("Event management failed", message || "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
