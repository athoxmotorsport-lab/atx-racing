import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();

export const siteUrl = (): URL => {
  const value = Deno.env.get("ATX_SITE_URL");
  if (!value) throw new Error("ATX_SITE_URL is not configured");
  return new URL(value.endsWith("/") ? value : `${value}/`);
};

export const functionUrl = (name: string): string => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured");
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${name}`;
};

const secretKey = (): string => {
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernKeys) {
    try {
      const parsed = JSON.parse(modernKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Fall back to the standard service-role environment variable below.
    }
  }
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey) throw new Error("Supabase secret key is not configured");
  return legacyKey;
};

export const adminClient = (): SupabaseClient => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured");
  return createClient(supabaseUrl, secretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

export const randomToken = (size = 32): string => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const hmacHex = async (value: string): Promise<string> => {
  const sessionSecret = Deno.env.get("SESSION_SECRET");
  if (!sessionSecret) throw new Error("SESSION_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(sessionSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const allowedOrigin = (): string => siteUrl().origin;

export const corsHeaders = (requestOrigin: string | null): HeadersInit => ({
  "Access-Control-Allow-Origin": requestOrigin === allowedOrigin() ? requestOrigin : allowedOrigin(),
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

export const assertAllowedOrigin = (request: Request): void => {
  const origin = request.headers.get("origin");
  if (origin && origin !== allowedOrigin()) throw new Error("ORIGIN_NOT_ALLOWED");
};

export const jsonResponse = (request: Request, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request.headers.get("origin")),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export const bearerToken = (request: Request): string | null => {
  const match = (request.headers.get("authorization") ?? "")
    .match(/^Bearer\s+([A-Za-z0-9_-]{40,})$/);
  return match?.[1] ?? null;
};
