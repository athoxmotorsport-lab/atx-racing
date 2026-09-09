BEGIN;

CREATE OR REPLACE VIEW public.event_honours
WITH (security_invoker = true)
AS
WITH fast_ranked AS (
  SELECT
    r.event_id,
    r.driver_id,
    r.best_lap_ms,
    row_number() OVER (
      PARTITION BY r.event_id
      ORDER BY r.best_lap_ms ASC, r.finish_position ASC NULLS LAST, r.driver_id
    ) AS award_rank
  FROM public.results r
  WHERE r.best_lap_ms IS NOT NULL AND r.best_lap_ms > 0
), gentleman_ranked AS (
  SELECT
    s.event_id,
    s.driver_id,
    s.valid_laps,
    s.clean_lap_streak,
    (
      s.invalid_laps + s.cuts + s.off_tracks + s.contacts +
      s.drive_throughs + s.stop_and_go_penalties + s.game_penalties
    ) AS penalty_count,
    row_number() OVER (
      PARTITION BY s.event_id
      ORDER BY
        (s.invalid_laps + s.cuts + s.off_tracks + s.contacts + s.drive_throughs + s.stop_and_go_penalties + s.game_penalties) ASC,
        s.valid_laps DESC,
        s.clean_lap_streak DESC,
        s.driver_id
    ) AS award_rank
  FROM public.safety_stats s
  WHERE s.valid_laps > 0
)
SELECT f.event_id, f.driver_id, 'fast_driver'::text AS award_type,
  f.best_lap_ms, NULL::integer AS penalty_count, NULL::integer AS clean_laps,
  e.slug AS event_slug, e.circuit_name, e.starts_at
FROM fast_ranked f JOIN public.events e ON e.id = f.event_id
WHERE f.award_rank = 1
UNION ALL
SELECT g.event_id, g.driver_id, 'gentleman_driver'::text AS award_type,
  NULL::integer AS best_lap_ms, g.penalty_count, g.valid_laps AS clean_laps,
  e.slug AS event_slug, e.circuit_name, e.starts_at
FROM gentleman_ranked g JOIN public.events e ON e.id = g.event_id
WHERE g.award_rank = 1;

COMMENT ON VIEW public.event_honours IS
  'Deterministic Fast Driver and Gentleman Driver awards calculated for each published race.';

REVOKE ALL ON public.event_honours FROM anon, authenticated;

COMMIT;
