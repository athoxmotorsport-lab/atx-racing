BEGIN;

-- Keep enough headroom for future rating algorithms. The ingestion function
-- still rejects ACC sentinel lap times before calculating this score.
ALTER TABLE public.driver_ratings
  ALTER COLUMN performance_score TYPE numeric(12, 3);

COMMIT;
