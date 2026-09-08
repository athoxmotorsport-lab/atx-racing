import { adminClient, functionUrl, hmacHex, randomToken, siteUrl } from "../_shared/auth.ts";

const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = `${OPENID_NS}/identifier_select`;
const STEAM_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

const redirect = (location: string): Response => new Response(null, {
  status: 302,
  headers: {
    "Location": location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  },
});

const failureRedirect = (reason = "auth_failed"): Response => {
  const destination = new URL("profil-pilote.html", siteUrl());
  destination.searchParams.set("steam", "error");
  destination.searchParams.set("reason", reason);
  return redirect(destination.toString());
};

const startLogin = async (): Promise<Response> => {
  const state = randomToken();
  const supabase = adminClient();
  const { error } = await supabase.from("auth_login_attempts").insert({
    state_hash: await hmacHex(state),
    return_path: "/profil-pilote.html",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) throw error;

  const callbackUrl = new URL(functionUrl("auth-steam"));
  callbackUrl.searchParams.set("state", state);

  const providerUrl = new URL(OPENID_ENDPOINT);
  providerUrl.searchParams.set("openid.ns", OPENID_NS);
  providerUrl.searchParams.set("openid.mode", "checkid_setup");
  providerUrl.searchParams.set("openid.return_to", callbackUrl.toString());
  providerUrl.searchParams.set("openid.realm", `${callbackUrl.origin}/`);
  providerUrl.searchParams.set("openid.identity", IDENTIFIER_SELECT);
  providerUrl.searchParams.set("openid.claimed_id", IDENTIFIER_SELECT);
  return redirect(providerUrl.toString());
};

const verifySteamAssertion = async (url: URL): Promise<string | null> => {
  const claimedId = url.searchParams.get("openid.claimed_id") ?? "";
  const identity = url.searchParams.get("openid.identity") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedReturnTo = new URL(functionUrl("auth-steam"));
  expectedReturnTo.searchParams.set("state", state);

  if (url.searchParams.get("openid.mode") !== "id_res") return null;
  if (url.searchParams.get("openid.ns") !== OPENID_NS) return null;
  if (url.searchParams.get("openid.return_to") !== expectedReturnTo.toString()) return null;
  if (claimedId !== identity) return null;

  const steamId = claimedId.match(STEAM_ID_PATTERN)?.[1];
  if (!steamId) return null;

  const verification = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith("openid.")) verification.set(key, value);
  }
  verification.set("openid.mode", "check_authentication");
  const response = await fetch(OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verification,
    redirect: "error",
  });
  if (!response.ok) return null;

  const values = Object.fromEntries(
    (await response.text()).trim().split("\n").map((line) => line.split(":", 2)),
  );
  return values.is_valid === "true" ? steamId : null;
};

type SteamPlayer = { personaname?: string; profileurl?: string; avatarfull?: string };

const fetchSteamPlayer = async (steamId: string): Promise<SteamPlayer> => {
  const apiKey = Deno.env.get("STEAM_API_KEY");
  if (!apiKey) throw new Error("STEAM_API_KEY is not configured");
  const endpoint = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("steamids", steamId);
  const response = await fetch(endpoint, { headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error("Steam profile request failed");
  const body = await response.json();
  return body?.response?.players?.[0] ?? {};
};

const finishLogin = async (url: URL): Promise<Response> => {
  const state = url.searchParams.get("state");
  if (!state || state.length > 128) return failureRedirect("invalid_state");

  const supabase = adminClient();
  const { data: consumed, error: consumeError } = await supabase.rpc(
    "consume_auth_login_attempt",
    { p_state_hash: await hmacHex(state) },
  );
  if (consumeError || consumed !== true) return failureRedirect("invalid_state");

  const steamId = await verifySteamAssertion(url);
  if (!steamId) return failureRedirect("steam_verification_failed");

  const player = await fetchSteamPlayer(steamId);
  const { data: driverId, error: driverError } = await supabase.rpc("upsert_steam_driver", {
    p_steam_id64: steamId,
    p_persona_name: player.personaname ?? "Steam Driver",
    p_profile_url: player.profileurl ?? `https://steamcommunity.com/profiles/${steamId}`,
    p_avatar_url: player.avatarfull ?? null,
  });
  if (driverError || !driverId) throw driverError ?? new Error("Driver creation failed");

  const exchangeCode = randomToken();
  const { error: exchangeError } = await supabase.from("auth_exchange_codes").insert({
    driver_id: driverId,
    code_hash: await hmacHex(exchangeCode),
    expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  });
  if (exchangeError) throw exchangeError;

  const destination = new URL("profil-pilote.html", siteUrl());
  destination.searchParams.set("steam", "success");
  destination.searchParams.set("steam_code", exchangeCode);
  return redirect(destination.toString());
};

Deno.serve(async (request) => {
  try {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    return url.searchParams.has("openid.mode") ? await finishLogin(url) : await startLogin();
  } catch (error) {
    console.error("Steam authentication failed", error instanceof Error ? error.message : "unknown error");
    return failureRedirect();
  }
});
