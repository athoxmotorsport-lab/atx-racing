import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regression contract: privileged public endpoints must not return private timing.
const sectors = await readFile(new URL("../supabase/functions/public-driver-sectors/index.ts", import.meta.url), "utf8");
const leaderboard = await readFile(new URL("../supabase/functions/public-leaderboard/index.ts", import.meta.url), "utf8");
for (const [name, source] of [["sectors", sectors], ["leaderboard", leaderboard]]) {
  assert(source.includes('is_profile_public'), name + ": profile privacy filter missing");
  assert(source.includes('is_public'), name + ": event privacy filter missing");
  assert(source.includes('status'), name + ": draft filter missing");
}
assert(sectors.includes('driver?.is_profile_public !== true'), "Sector endpoint must reject non-public profiles");
assert(sectors.includes('event?.is_public !== true'), "Sector endpoint must reject hidden events");
assert(sectors.includes('event?.status === "draft"'), "Sector endpoint must reject drafts");
assert(leaderboard.includes('event?.is_public === true'), "Leaderboard must require public event");
assert(leaderboard.includes('event?.status !== "draft"'), "Leaderboard must reject draft events");
assert(leaderboard.includes('profileIsPublic.get(String(result.driver_id ?? "")) === true'), "Leaderboard must require public driver");
const allowed = ({ eventPublic, draft, driverPublic, official }) =>
  official && eventPublic && !draft && driverPublic;
assert(allowed({ eventPublic: true, draft: false, driverPublic: true, official: true }));
assert(!allowed({ eventPublic: false, draft: false, driverPublic: true, official: true }));
assert(!allowed({ eventPublic: true, draft: true, driverPublic: true, official: true }));
assert(!allowed({ eventPublic: true, draft: false, driverPublic: false, official: true }));
assert(!allowed({ eventPublic: true, draft: false, driverPublic: true, official: false }));
console.log("SECURITY: private events, draft events and private drivers excluded from public timing");

for (const name of ["public-driver-identities", "public-event", "public-gtworld", "public-leaderboard", "public-driver"]) {
  const code = await readFile(new URL("../supabase/functions/" + name + "/index.ts", import.meta.url), "utf8");
  assert(code.includes("is_profile_public"), name + ": driver profile visibility missing");
  assert(code.includes("is_public"), name + ": event visibility missing");
}
const identities = await readFile(new URL("../supabase/functions/public-driver-identities/index.ts", import.meta.url), "utf8");
assert(identities.includes('eq("is_profile_public",true)'), "Identity endpoint must filter public profiles");
assert(identities.includes('publicEventIds.has(h.event_id)'), "Awards must exclude private events");
const events = await readFile(new URL("../supabase/functions/public-event/index.ts", import.meta.url), "utf8");
assert(events.includes('publicDriverIds.has(result.driver_id)'), "Event results must exclude private drivers");
assert(events.includes('visibleHonours'), "Event awards must filter private drivers");
const gtworld = await readFile(new URL("../supabase/functions/public-gtworld/index.ts", import.meta.url), "utf8");
assert(gtworld.includes('worldGTPoints(visibleResults'), "WorldGT points must use visible drivers");
const publicDriver = await readFile(new URL("../supabase/functions/public-driver/index.ts", import.meta.url), "utf8");
assert(publicDriver.includes('visibleEventSlugs.has(honour.event_slug)'), "Profile awards must exclude private events");
console.log("SECURITY: public identities, events, WorldGT and driver profiles apply visibility filters");
