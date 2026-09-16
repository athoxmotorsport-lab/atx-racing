import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders, hmacHex, jsonResponse,
} from "../_shared/auth.ts";

const IMAGE_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

Deno.serve(async (request) => {
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
    }
    if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);

    const token = bearerToken(request);
    if (!token) return jsonResponse(request, { error: "unauthorized" }, 401);

    const supabase = adminClient();
    const { data: session } = await supabase.from("auth_sessions").select("driver_id")
      .eq("token_hash", await hmacHex(token)).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!session) return jsonResponse(request, { error: "unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const match = String(body.image ?? "").match(IMAGE_PATTERN);
    if (!match) return jsonResponse(request, { error: "invalid_image" }, 400);

    const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
    if (bytes.length > MAX_IMAGE_BYTES) return jsonResponse(request, { error: "image_too_large" }, 400);

    const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
    const path = `${session.driver_id}/avatar.${extension}`;
    const { error: uploadError } = await supabase.storage.from("driver-avatars").upload(path, bytes, {
      contentType: match[1], upsert: true,
    });
    if (uploadError) throw uploadError;

    const publicUrl = supabase.storage.from("driver-avatars").getPublicUrl(path).data.publicUrl;
    const avatarUrl = `${publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await supabase.from("drivers").update({
      avatar_url: avatarUrl,
      custom_avatar_url: avatarUrl,
    }).eq("id", session.driver_id);
    if (updateError) throw updateError;

    return jsonResponse(request, { avatar_url: avatarUrl });
  } catch (error) {
    if (error instanceof Error && error.message === "ORIGIN_NOT_ALLOWED") {
      return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    }
    console.error("Avatar upload failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
