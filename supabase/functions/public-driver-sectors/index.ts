import { adminClient } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://athoxmotorsport-lab.github.io",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
});
const canonical = (value: unknown) => {
  const key = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    donington_park: "donington", nurburgring_gp: "nurburgring", nurburgring_2020: "nurburgring",
    nurburgring_gp_2020: "nurburgring", spa_francorchamps: "spa", circuit_of_the_americas: "cota",
    bathurst: "mount_panorama", watkins_glen_international: "watkins_glen", red_bull_ring_gp: "red_bull_ring",
  };
  return aliases[key] ?? key;
};
const validTime = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 3_600_000 ? n : null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const supabase = adminClient();
    const rows: Array<Record<string, unknown>> = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await supabase.from("acc_laps")
        .select("driver_id,lap_time_ms,is_valid,split_1_ms,split_2_ms,split_3_ms,created_at,driver:drivers!inner(is_profile_public),session:acc_sessions!inner(session_type,published_at,created_at,event:events!inner(circuit_key,circuit_name,is_official,is_public,status))")
        .eq("is_valid", true).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    type Timing = {
      driver_id: string; circuit_key: string; circuit_name: string;
      best_lap_ms: number | null; best_lap_session_type: string | null; best_lap_at: string | null;
      best_sector_1_ms: number | null; best_sector_2_ms: number | null; best_sector_3_ms: number | null;
    };
    const best = new Map<string, Timing>();
    for (const row of rows) {
      const driver = Array.isArray(row.driver) ? row.driver[0] : row.driver as Record<string, unknown> | null;
      if (driver?.is_profile_public !== true) continue;
      const session = Array.isArray(row.session) ? row.session[0] : row.session as Record<string, unknown> | null;
      const event = Array.isArray(session?.event) ? session?.event[0] : session?.event as Record<string, unknown> | null;
      if (event?.is_official === false || event?.is_public !== true || event?.status === "draft") continue;
      const driverId = String(row.driver_id ?? "");
      const circuitKey = canonical(event?.circuit_key ?? event?.circuit_name);
      if (!driverId || !circuitKey) continue;
      const key = `${driverId}|${circuitKey}`;
      const current = best.get(key) ?? {
        driver_id: driverId, circuit_key: circuitKey, circuit_name: String(event?.circuit_name ?? circuitKey),
        best_lap_ms: null, best_lap_session_type: null, best_lap_at: null,
        best_sector_1_ms: null, best_sector_2_ms: null, best_sector_3_ms: null,
      };
      const lap = validTime(row.lap_time_ms);
      if (lap !== null && (current.best_lap_ms === null || lap < current.best_lap_ms)) {
        current.best_lap_ms = lap;
        current.best_lap_session_type = String(session?.session_type ?? "").toUpperCase() || null;
        current.best_lap_at = String(session?.published_at ?? session?.created_at ?? row.created_at ?? "") || null;
        current.circuit_name = String(event?.circuit_name ?? current.circuit_name);
      }
      const sectors = [validTime(row.split_1_ms), validTime(row.split_2_ms), validTime(row.split_3_ms)];
      sectors.forEach((value, index) => {
        if (value === null) return;
        const field = `best_sector_${index + 1}_ms` as "best_sector_1_ms" | "best_sector_2_ms" | "best_sector_3_ms";
        if (current[field] === null || value < current[field]!) current[field] = value;
      });
      best.set(key, current);
    }
    return json({ generated_at: new Date().toISOString(), sectors: [...best.values()] });
  } catch (error) {
    console.error("Driver timing failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "server_error" }, 500);
  }
});
