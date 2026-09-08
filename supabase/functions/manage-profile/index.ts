import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders, hmacHex, jsonResponse,
} from "../_shared/auth.ts";

const textValue = (value: unknown, maximum: number): string | null => {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
  return cleaned || null;
};

const urlValue = (value: unknown, hosts?: string[]): string | null => {
  const cleaned = textValue(value, 300);
  if (!cleaned) return null;
  let url: URL;
  try { url = new URL(cleaned); } catch { throw new Error("INVALID_URL"); }
  if (url.protocol !== "https:") throw new Error("INVALID_URL");
  if (hosts && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("INVALID_URL");
  }
  return url.toString();
};

Deno.serve(async (request) => {
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
    if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);
    const token = bearerToken(request);
    if (!token) return jsonResponse(request, { error: "unauthorized" }, 401);
    const supabase = adminClient();
    const { data: session } = await supabase.from("auth_sessions").select("driver_id")
      .eq("token_hash", await hmacHex(token)).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!session) return jsonResponse(request, { error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const values = {
      team_name: textValue(body.teamName, 64),
      bio_fr: textValue(body.bioFr, 500),
      bio_en: textValue(body.bioEn, 500),
      twitch_url: urlValue(body.twitchUrl, ["twitch.tv"]),
      tiktok_url: urlValue(body.tiktokUrl, ["tiktok.com"]),
      youtube_url: urlValue(body.youtubeUrl, ["youtube.com", "youtu.be"]),
      website_url: urlValue(body.websiteUrl),
    };
    const { data: driver, error } = await supabase.from("drivers").update(values)
      .eq("id", session.driver_id)
      .select("id, display_name, avatar_url, team_name, bio_fr, bio_en, twitch_url, tiktok_url, youtube_url, website_url")
      .single();
    if (error) throw error;
    return jsonResponse(request, { driver });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ORIGIN_NOT_ALLOWED") return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    if (message === "INVALID_URL") return jsonResponse(request, { error: "invalid_social_url" }, 400);
    console.error("Profile update failed", message || "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
