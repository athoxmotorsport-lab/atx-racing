import { adminClient } from "../_shared/auth.ts";
const cors={"Access-Control-Allow-Origin":"https://athoxmotorsport-lab.github.io","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60"}});
Deno.serve(async(request)=>{
  if(request.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(request.method!=="GET") return json({error:"method_not_allowed"},405);
  try{
    const {data,error}=await adminClient().rpc("public_driver_sector_bests");
    if(error) throw error;
    return json({generated_at:new Date().toISOString(),sectors:data??[]});
  }catch(error){console.error("Driver sectors failed",error instanceof Error?error.message:"unknown error");return json({error:"server_error"},500);}
});
