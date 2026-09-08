BEGIN;

-- ATX Racing points from 8 September 2026:
-- P1 25, P2 18, P3 15, P4 12, P5 10, P6 8, P7 6, P8 4, P9 2, P10 1.
-- The single fastest valid stored race lap receives a two-point bonus.
WITH recalculated AS (
  SELECT
    result_row.id,
    CASE
      WHEN result_row.status <> 'classified' THEN 0
      WHEN result_row.finish_position = 1 THEN 25
      WHEN result_row.finish_position = 2 THEN 18
      WHEN result_row.finish_position = 3 THEN 15
      WHEN result_row.finish_position = 4 THEN 12
      WHEN result_row.finish_position = 5 THEN 10
      WHEN result_row.finish_position = 6 THEN 8
      WHEN result_row.finish_position = 7 THEN 6
      WHEN result_row.finish_position = 8 THEN 4
      WHEN result_row.finish_position = 9 THEN 2
      WHEN result_row.finish_position = 10 THEN 1
      ELSE 0
    END AS position_points,
    CASE
      WHEN result_row.best_lap_ms IS NOT NULL
        AND row_number() OVER (
          PARTITION BY result_row.event_id
          ORDER BY result_row.best_lap_ms ASC NULLS LAST,
                   result_row.finish_position ASC NULLS LAST,
                   result_row.id ASC
        ) = 1
      THEN 2
      ELSE 0
    END AS fastest_lap_points
  FROM public.results AS result_row
)
UPDATE public.results AS result_row
SET points = recalculated.position_points + recalculated.fastest_lap_points
FROM recalculated
WHERE result_row.id = recalculated.id;

COMMIT;
