-- Allow race-specific fixed refuelling durations, including values above 600 seconds.
-- Keep only the nonnegative requirement; PostgreSQL integer storage remains the technical limit.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_fixed_refuelling_seconds_range;

ALTER TABLE public.events
  ADD CONSTRAINT events_fixed_refuelling_seconds_range
  CHECK (fixed_refuelling_seconds IS NULL OR fixed_refuelling_seconds >= 0);
