import { adminClient, functionUrl, hmacHex, randomToken, siteUrl } from "../_shared/auth.ts";

const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = `${OPENID_NS}/identifier_select`;
const STEAM_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const OLD_PROFILE = "/atx-racing/profil-pilote.html";
// A fixed path allowlist prevents OpenID from becoming an open redirect.
const allowedReturnPath = (path: string | null): string =>
  path && /^\/atxracing\/(fr|en|de|it|es)\/(acc|ace)\/profile\.html$/.test(path) ? path : OLD_PROFILE;

const destinationFor = (path: string): URL => new URL(path, siteUrl().origin);

const storedReturnPath = async (state: string | null): Promise<string> => {
  if (!state || state.length > 128) return OLD_PROFILE;
  const { data } = await adminClient().from("auth_login_attempts")
    .select("return_path").eq("state_hash", await hmacHex(state)).maybeSingle();
  return allowedReturnPath(data?.return_path ?? null);
};

const redirect = (location: string): Response => new Response(null, {
  status: 302,
  headers: {
    "Location": location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  },
});

const failureRedirect = (reason = "auth_failed", returnPath = OLD_PROFILE): Response => {
  const destination = destinationFor(returnPath);
  destination.searchParams.set("steam", "error");
  destination.searchParams.set("reason", reason);
  return redirect(destination.toString());
};

const startLogin = async (url: URL): Promise<Response> => {
  const state = randomToken();
  const returnPath = allowedReturnPath(url.searchParams.get("return_path"));
  const supabase = adminClient();
  const { error } = await supabase.from("auth_login_attempts").insert({
    state_hash: await hmacHex(state),
    return_path: returnPath,
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

const decodeXmlText = (value: string): string => value
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#39;", "'")
  .trim();

const cleanPersonaName = (value?: string): string | undefined => {
  let name = String(value ?? "").trim();
  if (!name || /^<!\[CDATA\[.*\]\]>$/is.test(name) || /<!\[CDATA\[/i.test(name)) return undefined;
  // HTML fallbacks can expose the browser page title rather than the persona itself.
  // Keep only the actual Steam nickname (e.g. "Steam Community :: leclouxrodrigue" -> "leclouxrodrigue").
  name = name.replace(/^Steam\s+Community\s*::\s*/i, "").trim();
  return name ? name.slice(0, 64) : undefined;
};

const xmlTag = (xml: string, tag: string): string | undefined => {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"));
  if (cdata) return cleanPersonaName(cdata[1]);
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return plain?.[1] ? cleanPersonaName(decodeXmlText(plain[1])) : undefined;
};

const htmlProfileName = (html: string): string | undefined => {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const title = html.match(/<title>\s*Steam Community\s*::\s*([\s\S]*?)<\/title>/i);
  return cleanPersonaName(decodeXmlText(og?.[1] ?? title?.[1] ?? ""));
};

const fetchCommunityProfile = async (steamId: string): Promise<SteamPlayer> => {
  try {
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
    const response = await fetch(`${profileUrl}/?xml=1`, {
      headers: { "Accept": "application/xml", "User-Agent": "ATX-Racing/1.0" },
    });
    if (!response.ok) {
      console.warn(`Steam Community profile returned HTTP ${response.status}`);
      return {};
    }
    const xml = await response.text();
    let personaname = xmlTag(xml, "steamID");
    let avatarfull = xmlTag(xml, "avatarFull");

    if (!personaname) {
      try {
        const htmlResponse = await fetch(profileUrl, {
          headers: { "Accept": "text/html", "User-Agent": "ATX-Racing/1.0" },
        });
        if (htmlResponse.ok) personaname = htmlProfileName(await htmlResponse.text());
      } catch {
        // Keep the ACC display name when Steam does not expose a usable persona name.
      }
    }

    return { personaname, profileurl: profileUrl, avatarfull };
  } catch (error) {
    console.warn(
      "Steam Community profile enrichment failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return {};
  }
};

const fetchSteamPlayer = async (steamId: string): Promise<SteamPlayer> => {
  const apiKey = Deno.env.get("STEAM_API_KEY");
  if (!apiKey) {
    console.warn("Steam profile enrichment skipped: STEAM_API_KEY is not configured");
    return await fetchCommunityProfile(steamId);
  }

  try {
    const endpoint = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    endpoint.searchParams.set("key", apiKey);
    endpoint.searchParams.set("steamids", steamId);
    const response = await fetch(endpoint, {
      headers: { "Accept": "application/json", "User-Agent": "ATX-Racing/1.0" },
    });
    if (!response.ok) {
      console.warn(`Steam profile enrichment returned HTTP ${response.status}`);
      return await fetchCommunityProfile(steamId);
    }
    const body = await response.json();
    const player = body?.response?.players?.[0];
    if (player) {
      player.personaname = cleanPersonaName(player.personaname);
      return player;
    }
    return await fetchCommunityProfile(steamId);
  } catch (error) {
    console.warn(
      "Steam profile enrichment failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return await fetchCommunityProfile(steamId);
  }
};

const finishLogin = async (url: URL): Promise<Response> => {
  const state = url.searchParams.get("state");
  if (!state || state.length > 128) return failureRedirect("invalid_state");
  const returnPath = await storedReturnPath(state);

  const supabase = adminClient();
  const { data: consumed, error: consumeError } = await supabase.rpc(
    "consume_auth_login_attempt",
    { p_state_hash: await hmacHex(state) },
  );
  if (consumeError || consumed !== true) return failureRedirect("invalid_state", returnPath);

  const steamId = await verifySteamAssertion(url);
  if (!steamId) return failureRedirect("steam_verification_failed", returnPath);

  const player = await fetchSteamPlayer(steamId);
  let personaName = cleanPersonaName(player.personaname);

  if (!personaName) {
    const { data: identity } = await supabase.from("driver_identities")
      .select("driver_id").eq("steam_id64", steamId).maybeSingle();
    if (identity?.driver_id) {
      const { data: existingDriver } = await supabase.from("drivers")
        .select("display_name").eq("id", identity.driver_id).maybeSingle();
      personaName = cleanPersonaName(existingDriver?.display_name);
    }
  }

  const { data: driverId, error: driverError } = await supabase.rpc("upsert_steam_driver", {
    p_steam_id64: steamId,
    p_persona_name: personaName ?? "Steam Driver",
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

  const destination = destinationFor(returnPath);
  destination.hash = new URLSearchParams({
    steam: "success",
    steam_code: exchangeCode,
  }).toString();
  return redirect(destination.toString());
};

Deno.serve(async (request) => {
  try {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    if (url.searchParams.get("openid.mode") === "cancel") return failureRedirect("user_cancelled", await storedReturnPath(url.searchParams.get("state")));
    return url.searchParams.has("openid.mode") ? await finishLogin(url) : await startLogin(url);
  } catch (error) {
    console.error("Steam authentication failed", error instanceof Error ? error.message : "unknown error");
    return failureRedirect();
  }
});
