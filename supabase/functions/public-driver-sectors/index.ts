import { adminClient } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://athoxmotorsport-lab.github.io",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
const canonical = (value: unknown) => {
  const key = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases: Record<string,string> = { donington_park:"donington", nurburgring_gp:"nurburgring", nurburgring_2020:"nurburgring", nurburgring_gp_2020:"nurburgring", spa_francorchamps:"spa", circuit_of_the_americas:"cota" };
  return aliases[key] ?? key;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "GET") return json({ error:"method_not_allowed" },405);
  try {
    const supabase = adminClient();
    const rows: Array<Record<string,unknown>> = [];
    for (let from=0; from<20000; from+=1000) {
      const { data,error } = await supabase.from("acc_laps")
        .select("driver_id,lap_time_ms,is_valid,split_1_ms,split_2_ms,split_3_ms,session:acc_sessions!inner(event:events!inner(circuit_key,circuit_name,is_official))")
        .eq("is_valid",true).range(from,from+999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length<1000) break;
    }
    const best = new Map<string,{driver_id:string,circuit_key:string,best_sector_1_ms:number|null,best_sector_2_ms:number|null,best_sector_3_ms:number|null}>();
    const valid = (v:unknown) => { const n=Number(v); return Number.isFinite(n)&&n>0&&n<3600000?n:null; };
    for (const row of rows) {
      const session = Array.isArray(row.session)?row.session[0]:row.session as Record<string,unknown>|null;
      const event = Array.isArray(session?.event)?session.event[0]:session?.event as Record<string,unknown>|null;
      if (event?.is_official === false) continue;
      const circuit_key=canonical(event?.circuit_key ?? event?.circuit_name);
      const driver_id=String(row.driver_id ?? "");
      if (!driver_id||!circuit_key) continue;
      const key=`${driver_id}|${circuit_key}`;
      const current=best.get(key) ?? {driver_id,circuit_key,best_sector_1_ms:null,best_sector_2_ms:null,best_sector_3_ms:null};
      const values=[valid(row.split_1_ms),valid(row.split_2_ms),valid(row.split_3_ms)];
      values.forEach((value,i)=>{ if(value===null)return; const field=`best_sector_${i+1}_ms` as "best_sector_1_ms"|"best_sector_2_ms"|"best_sector_3_ms"; if(current[field]===null||value<current[field]!) current[field]=value; });
      best.set(key,current);
    }
    return json({generated_at:new Date().toISOString(),sectors:[...best.values()]});
  } catch(error) {
    console.error("Driver sectors failed",error instanceof Error?error.message:"unknown error");
    return json({error:"server_error"},500);
  }
});
