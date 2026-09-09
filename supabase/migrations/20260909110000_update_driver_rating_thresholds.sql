BEGIN;

-- A SAFE score below 39% intentionally has no badge.
ALTER TABLE public.driver_ratings
  ALTER COLUMN safety_class DROP NOT NULL,
  ALTER COLUMN safety_class DROP DEFAULT;

UPDATE public.driver_ratings
SET performance_class = CASE
  WHEN performance_score < 102 THEN 'alien'::public.performance_class
  WHEN performance_score < 104 THEN 'elite'::public.performance_class
  WHEN performance_score < 106 THEN 'pro'::public.performance_class
  ELSE 'rookie'::public.performance_class
END,
safety_class = CASE
  WHEN safety_score >= 80 THEN 'gold'::public.safety_class
  WHEN safety_score >= 60 THEN 'silver'::public.safety_class
  WHEN safety_score >= 39 THEN 'bronze'::public.safety_class
  ELSE NULL
END,
algorithm_version = 'acc-v2',
calculated_at = now();

COMMENT ON COLUMN public.driver_ratings.performance_score IS
  'Pace index: best driver lap divided by the event reference lap, multiplied by 100.';
COMMENT ON COLUMN public.driver_ratings.safety_score IS
  'Percentage of valid laps in imported ACC lap data; scores below 39 have no SAFE badge.';

COMMIT;
