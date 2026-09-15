create or replace function public.public_driver_sector_bests()
returns table(driver_id uuid, circuit_key text, best_sector_1_ms integer, best_sector_2_ms integer, best_sector_3_ms integer)
language sql stable security definer set search_path=public
as $$
select l.driver_id,
 public.canonical_acc_circuit_key(coalesce(e.circuit_key,e.circuit_name)),
 min(l.split_1_ms) filter(where l.is_valid and l.split_1_ms>0 and l.split_1_ms<3600000)::integer,
 min(l.split_2_ms) filter(where l.is_valid and l.split_2_ms>0 and l.split_2_ms<3600000)::integer,
 min(l.split_3_ms) filter(where l.is_valid and l.split_3_ms>0 and l.split_3_ms<3600000)::integer
from public.acc_laps l join public.acc_sessions s on s.id=l.session_id join public.events e on e.id=s.event_id
where coalesce(e.is_official,true) is true
group by l.driver_id,public.canonical_acc_circuit_key(coalesce(e.circuit_key,e.circuit_name));
$$;
revoke all on function public.public_driver_sector_bests() from public;
grant execute on function public.public_driver_sector_bests() to service_role;
