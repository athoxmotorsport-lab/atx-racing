import {
  adminClient, assertAllowedOrigin, bearerToken, corsHeaders, hmacHex, jsonResponse,
} from "../_shared/auth.ts";

Deno.serve(async (request) => {
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders(request.headers.get("origin")) });
    }
    if (request.method !== "POST") {
      return jsonResponse(request, { error: "method_not_allowed" }, 405);
    }
    const token = bearerToken(request);
    if (!token) return jsonResponse(request, { error: "missing_session" }, 401);
    const supabase = adminClient();
    await supabase.from("auth_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", await hmacHex(token)).is("revoked_at", null);
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ORIGIN_NOT_ALLOWED") {
      return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    }
    console.error("Logout failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse(request, { error: "server_error" }, 500);
  }
});
