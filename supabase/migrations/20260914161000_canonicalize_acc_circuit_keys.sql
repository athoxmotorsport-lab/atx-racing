create or replace function public.canonical_acc_circuit_key(value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := lower(trim(coalesce(value, '')));
  normalized := translate(normalized, 'ü', 'u');
  normalized := regexp_replace(normalized, '[^a-z0-9]+', '_', 'g');
  normalized := regexp_replace(normalized, '^_+|_+$', '', 'g');

  return case normalized
    when 'barcelona' then 'barcelona'
    when 'barcelone' then 'barcelona'
    when 'barcelona_catalunya' then 'barcelona'
    when 'circuit_de_barcelona_catalunya' then 'barcelona'
    when 'catalunya' then 'barcelona'

    when 'brands_hatch' then 'brands_hatch'
    when 'brands_hatch_gp' then 'brands_hatch'

    when 'cota' then 'cota'
    when 'circuit_of_the_americas' then 'cota'
    when 'circuit_of_americas' then 'cota'

    when 'donington' then 'donington'
    when 'donington_park' then 'donington'

    when 'hungaroring' then 'hungaroring'
    when 'hungaroring_gp' then 'hungaroring'

    when 'imola' then 'imola'
    when 'imola_2020' then 'imola'
    when 'autodromo_internazionale_enzo_e_dino_ferrari' then 'imola'

    when 'indianapolis' then 'indianapolis'
    when 'indianapolis_motor_speedway' then 'indianapolis'

    when 'kyalami' then 'kyalami'
    when 'kyalami_grand_prix_circuit' then 'kyalami'

    when 'laguna_seca' then 'laguna_seca'
    when 'weathertech_raceway_laguna_seca' then 'laguna_seca'

    when 'misano' then 'misano'
    when 'misano_world_circuit' then 'misano'

    when 'monza' then 'monza'
    when 'autodromo_nazionale_monza' then 'monza'

    when 'mount_panorama' then 'mount_panorama'
    when 'mount_panorama_circuit' then 'mount_panorama'
    when 'bathurst' then 'mount_panorama'

    when 'nurburgring' then 'nurburgring'
    when 'nurburgring_gp' then 'nurburgring'
    when 'nurburgring_2020' then 'nurburgring'
    when 'nurburgring_gp_2020' then 'nurburgring'

    when 'nurburgring_24h' then 'nurburgring_24h'
    when 'nurburgring_24h_2024' then 'nurburgring_24h'
    when 'nordschleife' then 'nurburgring_24h'

    when 'oulton_park' then 'oulton_park'
    when 'oulton_park_international' then 'oulton_park'

    when 'paul_ricard' then 'paul_ricard'
    when 'circuit_paul_ricard' then 'paul_ricard'

    when 'red_bull_ring' then 'red_bull_ring'
    when 'red_bull_ring_gp' then 'red_bull_ring'

    when 'silverstone' then 'silverstone'
    when 'silverstone_circuit' then 'silverstone'

    when 'snetterton' then 'snetterton'
    when 'snetterton_300' then 'snetterton'

    when 'spa' then 'spa'
    when 'spa_francorchamps' then 'spa'
    when 'circuit_de_spa_francorchamps' then 'spa'

    when 'suzuka' then 'suzuka'
    when 'suzuka_circuit' then 'suzuka'

    when 'valencia' then 'valencia'
    when 'circuit_ricardo_tormo' then 'valencia'

    when 'watkins_glen' then 'watkins_glen'
    when 'watkins_glen_international' then 'watkins_glen'

    when 'zandvoort' then 'zandvoort'
    when 'zandvoort_2020' then 'zandvoort'
    when 'circuit_zandvoort' then 'zandvoort'

    when 'zolder' then 'zolder'
    when 'circuit_zolder' then 'zolder'

    when '' then 'circuit_inconnu'
    else normalized
  end;
end;
$$;

create or replace function public.enforce_canonical_event_circuit_key()
returns trigger
language plpgsql
as $$
begin
  new.circuit_key := public.canonical_acc_circuit_key(coalesce(nullif(new.circuit_name, ''), new.circuit_key));
  return new;
end;
$$;

drop trigger if exists trg_events_canonical_circuit_key on public.events;
create trigger trg_events_canonical_circuit_key
before insert or update of circuit_name, circuit_key on public.events
for each row
execute function public.enforce_canonical_event_circuit_key();

update public.events
set circuit_key = public.canonical_acc_circuit_key(coalesce(nullif(circuit_name, ''), circuit_key));
