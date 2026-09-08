BEGIN;

-- Collector v2: one public event per actual ACC race instead of one event per
-- circuit/day. Existing Collector imports are reset because their standings
-- were merged before a stable race key existed. Steam identities and driver
-- profiles are deliberately preserved.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS source_event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS events_source_event_key_unique
  ON public.events (source_event_key)
  WHERE source_event_key IS NOT NULL;

ALTER TABLE public.ingestion_batches
  ADD COLUMN IF NOT EXISTS processor_version text NOT NULL DEFAULT 'acc-v1';

CREATE TEMP TABLE legacy_acc_events ON COMMIT DROP AS
SELECT DISTINCT event_id
FROM public.acc_sessions;

CREATE TEMP TABLE legacy_acc_drivers ON COMMIT DROP AS
SELECT DISTINCT result_row.driver_id
FROM public.acc_session_results result_row
JOIN public.acc_sessions session_row ON session_row.id = result_row.session_id;

DELETE FROM public.driver_ratings
WHERE driver_id IN (SELECT driver_id FROM legacy_acc_drivers);

DELETE FROM public.acc_sessions
WHERE event_id IN (SELECT event_id FROM legacy_acc_events);

DELETE FROM public.results
WHERE event_id IN (SELECT event_id FROM legacy_acc_events);

DELETE FROM public.safety_stats
WHERE event_id IN (SELECT event_id FROM legacy_acc_events);

DELETE FROM public.events
WHERE id IN (SELECT event_id FROM legacy_acc_events)
  AND slug NOT IN ('monza-2026-09-09', 'nurburgring-gp-2026-09-11');

UPDATE public.events
SET source_event_key = NULL,
    published_at = NULL,
    status = CASE
      WHEN slug = 'monza-2026-09-09' THEN 'registration_open'::public.event_status
      ELSE 'announced'::public.event_status
    END
WHERE slug IN ('monza-2026-09-09', 'nurburgring-gp-2026-09-11');

DELETE FROM public.ingestion_batches
WHERE source = 'atx-racing-collector';

COMMENT ON COLUMN public.events.source_event_key IS
  'Stable Collector key identifying one actual ACC race and its related sessions.';
COMMENT ON COLUMN public.ingestion_batches.processor_version IS
  'Importer version used to decide whether an existing checksum must be reprocessed.';

COMMIT;
