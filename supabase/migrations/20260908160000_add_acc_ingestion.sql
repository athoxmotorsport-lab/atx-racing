BEGIN;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS server_name text,
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS car_model_id integer,
  ADD COLUMN IF NOT EXISTS car_model_name text,
  ADD COLUMN IF NOT EXISTS race_number integer,
  ADD COLUMN IF NOT EXISTS best_split_1_ms integer,
  ADD COLUMN IF NOT EXISTS best_split_2_ms integer,
  ADD COLUMN IF NOT EXISTS best_split_3_ms integer;

CREATE TABLE public.acc_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  payload_checksum text NOT NULL UNIQUE,
  source_file text NOT NULL,
  session_type text NOT NULL,
  session_index integer,
  session_date date,
  is_wet boolean NOT NULL DEFAULT false,
  server_name text,
  raw_storage_path text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acc_sessions_checksum_format CHECK (payload_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT acc_sessions_type CHECK (session_type IN ('FP', 'Q', 'R', 'INCONNU'))
);

CREATE TABLE public.acc_session_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.acc_sessions(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  position integer,
  laps_completed integer NOT NULL DEFAULT 0,
  best_lap_ms integer,
  best_split_1_ms integer,
  best_split_2_ms integer,
  best_split_3_ms integer,
  total_time_ms bigint,
  car_model_id integer,
  car_model_name text,
  race_number integer,
  car_group text,
  status public.result_status NOT NULL DEFAULT 'classified',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, driver_id)
);

CREATE TABLE public.acc_laps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.acc_sessions(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  lap_number integer NOT NULL,
  lap_time_ms integer,
  is_valid boolean NOT NULL DEFAULT true,
  split_1_ms integer,
  split_2_ms integer,
  split_3_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, driver_id, lap_number)
);

CREATE TABLE public.acc_game_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.acc_sessions(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  reason text,
  penalty_code text,
  penalty_value integer,
  violation_lap integer,
  cleared_lap integer,
  is_post_race boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX acc_sessions_event_idx ON public.acc_sessions (event_id, session_type);
CREATE INDEX acc_session_results_driver_idx ON public.acc_session_results (driver_id);
CREATE INDEX acc_laps_driver_idx ON public.acc_laps (driver_id, is_valid);
CREATE INDEX acc_game_penalties_driver_idx ON public.acc_game_penalties (driver_id);

ALTER TABLE public.acc_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_session_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_laps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acc_game_penalties ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acc_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.acc_session_results FROM anon, authenticated;
REVOKE ALL ON TABLE public.acc_laps FROM anon, authenticated;
REVOKE ALL ON TABLE public.acc_game_penalties FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('acc-results', 'acc-results', false, 15728640, ARRAY['application/json'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (
  slug, event_type, status, title_fr, title_en, description_fr, description_en,
  game, circuit_name, circuit_key, starts_at, timezone, duration_minutes,
  max_drivers, simgrid_url, image_url, server_name, is_public, is_official
)
VALUES
  (
    'monza-2026-09-09', 'special_event', 'registration_open',
    'ATX Racing · Monza', 'ATX Racing · Monza',
    'Course GT3 officielle ATX Racing de 60 minutes.',
    'Official 60-minute ATX Racing GT3 race.',
    'Assetto Corsa Competizione', 'Monza', 'monza',
    '2026-09-09 20:30:00+02', 'Europe/Brussels', 60, 22,
    'https://www.thesimgrid.com/communities/atxracing',
    '/assets/events/monza-2026-09-09.jpg', 'ATX Racing', true, true
  ),
  (
    'nurburgring-gp-2026-09-11', 'special_event', 'announced',
    'ATX Racing · Nürburgring GP', 'ATX Racing · Nürburgring GP',
    'Course GT3 officielle ATX Racing de 60 minutes.',
    'Official 60-minute ATX Racing GT3 race.',
    'Assetto Corsa Competizione', 'Nürburgring GP', 'nurburgring',
    '2026-09-11 20:30:00+02', 'Europe/Brussels', 60, 22,
    'https://www.thesimgrid.com/communities/atxracing',
    '/assets/events/nurburgring-gp-2026-09-11.webp', 'ATX Racing', true, true
  )
ON CONFLICT (slug) DO UPDATE SET
  title_fr = EXCLUDED.title_fr,
  title_en = EXCLUDED.title_en,
  circuit_name = EXCLUDED.circuit_name,
  circuit_key = EXCLUDED.circuit_key,
  starts_at = EXCLUDED.starts_at,
  duration_minutes = EXCLUDED.duration_minutes,
  max_drivers = EXCLUDED.max_drivers,
  simgrid_url = EXCLUDED.simgrid_url,
  image_url = EXCLUDED.image_url,
  is_public = EXCLUDED.is_public,
  is_official = EXCLUDED.is_official;

COMMENT ON TABLE public.acc_sessions IS 'Normalized ACC session imports linked to an ATX Racing event.';
COMMENT ON TABLE public.acc_laps IS 'Private detailed ACC laps retained for performance and SAFE calculations.';
COMMENT ON TABLE public.acc_game_penalties IS 'Private raw game penalties, distinct from steward-issued penalties.';

COMMIT;
