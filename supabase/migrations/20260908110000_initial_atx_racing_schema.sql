BEGIN;

-- ATX Racing initial database schema.
-- Public driver information is deliberately separated from Steam identities,
-- authentication sessions, staff roles and ingestion/audit data.

CREATE TYPE public.event_type AS ENUM (
  'daily_race',
  'sprint',
  'endurance',
  'championship',
  'special_event'
);

CREATE TYPE public.event_status AS ENUM (
  'draft',
  'announced',
  'registration_open',
  'registration_closed',
  'completed',
  'cancelled'
);

CREATE TYPE public.registration_status AS ENUM (
  'pending',
  'confirmed',
  'waitlist',
  'withdrawn',
  'rejected'
);

CREATE TYPE public.result_status AS ENUM (
  'classified',
  'dnf',
  'dns',
  'dsq'
);

CREATE TYPE public.penalty_type AS ENUM (
  'warning',
  'time',
  'position',
  'drive_through',
  'stop_and_go',
  'disqualification',
  'event_exclusion'
);

CREATE TYPE public.penalty_status AS ENUM (
  'draft',
  'published',
  'served',
  'revoked'
);

CREATE TYPE public.performance_class AS ENUM (
  'rookie',
  'pro',
  'elite',
  'alien'
);

CREATE TYPE public.safety_class AS ENUM (
  'bronze',
  'silver',
  'gold'
);

CREATE TYPE public.app_role AS ENUM (
  'driver',
  'steward',
  'admin'
);

CREATE TYPE public.ingestion_status AS ENUM (
  'pending',
  'processed',
  'rejected',
  'failed'
);

CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_slug text UNIQUE,
  display_name text NOT NULL,
  avatar_url text,
  country_code text,
  bio_fr text,
  bio_en text,
  is_profile_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drivers_display_name_length
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 64),
  CONSTRAINT drivers_profile_slug_format
    CHECK (profile_slug IS NULL OR profile_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT drivers_country_code_format
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT drivers_avatar_url_https
    CHECK (avatar_url IS NULL OR avatar_url ~ '^https://')
);

CREATE TABLE public.driver_identities (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id) ON DELETE CASCADE,
  steam_id64 text NOT NULL UNIQUE,
  steam_persona_name text,
  steam_profile_url text,
  steam_avatar_url text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_identities_steam_id64_format
    CHECK (steam_id64 ~ '^[0-9]{17}$'),
  CONSTRAINT driver_identities_profile_url_https
    CHECK (steam_profile_url IS NULL OR steam_profile_url ~ '^https://'),
  CONSTRAINT driver_identities_avatar_url_https
    CHECK (steam_avatar_url IS NULL OR steam_avatar_url ~ '^https://')
);

CREATE TABLE public.driver_roles (
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'driver',
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  PRIMARY KEY (driver_id, role)
);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  event_type public.event_type NOT NULL DEFAULT 'special_event',
  status public.event_status NOT NULL DEFAULT 'draft',
  title_fr text NOT NULL,
  title_en text NOT NULL,
  description_fr text,
  description_en text,
  game text NOT NULL DEFAULT 'Assetto Corsa Competizione',
  circuit_name text NOT NULL,
  circuit_key text NOT NULL,
  starts_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Brussels',
  duration_minutes integer NOT NULL,
  max_drivers integer NOT NULL DEFAULT 22,
  simgrid_url text,
  image_url text,
  regulations_fr text,
  regulations_en text,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_slug_format
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT events_circuit_key_format
    CHECK (circuit_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT events_duration_range
    CHECK (duration_minutes BETWEEN 1 AND 1440),
  CONSTRAINT events_max_drivers_range
    CHECK (max_drivers BETWEEN 1 AND 100),
  CONSTRAINT events_simgrid_url_https
    CHECK (simgrid_url IS NULL OR simgrid_url ~ '^https://'),
  CONSTRAINT events_image_url_https_or_relative
    CHECK (image_url IS NULL OR image_url ~ '^https://' OR image_url ~ '^/')
);

CREATE TABLE public.registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  status public.registration_status NOT NULL DEFAULT 'pending',
  race_number integer,
  car_model text,
  team_name text,
  external_source text,
  external_reference text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_id),
  CONSTRAINT registrations_race_number_range
    CHECK (race_number IS NULL OR race_number BETWEEN 0 AND 999)
);

CREATE TABLE public.results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  status public.result_status NOT NULL DEFAULT 'classified',
  qualifying_position integer,
  start_position integer,
  finish_position integer,
  laps_completed integer NOT NULL DEFAULT 0,
  best_lap_ms integer,
  total_time_ms bigint,
  points numeric(10, 2) NOT NULL DEFAULT 0,
  imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_id),
  CONSTRAINT results_qualifying_position_positive
    CHECK (qualifying_position IS NULL OR qualifying_position > 0),
  CONSTRAINT results_start_position_positive
    CHECK (start_position IS NULL OR start_position > 0),
  CONSTRAINT results_finish_position_positive
    CHECK (finish_position IS NULL OR finish_position > 0),
  CONSTRAINT results_laps_nonnegative CHECK (laps_completed >= 0),
  CONSTRAINT results_best_lap_positive CHECK (best_lap_ms IS NULL OR best_lap_ms > 0),
  CONSTRAINT results_total_time_positive CHECK (total_time_ms IS NULL OR total_time_ms > 0)
);

CREATE TABLE public.safety_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  valid_laps integer NOT NULL DEFAULT 0,
  invalid_laps integer NOT NULL DEFAULT 0,
  cuts integer NOT NULL DEFAULT 0,
  off_tracks integer NOT NULL DEFAULT 0,
  contacts integer NOT NULL DEFAULT 0,
  drive_throughs integer NOT NULL DEFAULT 0,
  stop_and_go_penalties integer NOT NULL DEFAULT 0,
  game_penalties integer NOT NULL DEFAULT 0,
  clean_lap_streak integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_id),
  CONSTRAINT safety_stats_nonnegative CHECK (
    valid_laps >= 0
    AND invalid_laps >= 0
    AND cuts >= 0
    AND off_tracks >= 0
    AND contacts >= 0
    AND drive_throughs >= 0
    AND stop_and_go_penalties >= 0
    AND game_penalties >= 0
    AND clean_lap_streak >= 0
  )
);

CREATE TABLE public.penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  penalty_type public.penalty_type NOT NULL,
  status public.penalty_status NOT NULL DEFAULT 'draft',
  time_seconds integer,
  position_loss integer,
  reason_fr text NOT NULL,
  reason_en text,
  issued_by uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penalties_time_nonnegative
    CHECK (time_seconds IS NULL OR time_seconds >= 0),
  CONSTRAINT penalties_position_loss_positive
    CHECK (position_loss IS NULL OR position_loss > 0),
  CONSTRAINT penalties_reason_not_empty
    CHECK (char_length(btrim(reason_fr)) > 0)
);

CREATE TABLE public.driver_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  circuit_key text NOT NULL DEFAULT 'overall',
  performance_class public.performance_class NOT NULL DEFAULT 'rookie',
  performance_score numeric(8, 3) NOT NULL DEFAULT 0,
  safety_class public.safety_class NOT NULL DEFAULT 'bronze',
  safety_score numeric(8, 3) NOT NULL DEFAULT 0,
  algorithm_version text NOT NULL DEFAULT 'v1',
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, circuit_key),
  CONSTRAINT driver_ratings_circuit_key_format
    CHECK (circuit_key = 'overall' OR circuit_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  CONSTRAINT driver_ratings_scores_nonnegative
    CHECK (performance_score >= 0 AND safety_score >= 0)
);

CREATE TABLE public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token_hash text,
  user_agent_hash text,
  ip_address_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT auth_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE TABLE public.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  external_reference text,
  payload_checksum text NOT NULL UNIQUE,
  status public.ingestion_status NOT NULL DEFAULT 'pending',
  imported_events integer NOT NULL DEFAULT 0,
  imported_results integer NOT NULL DEFAULT 0,
  rejected_records integer NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT ingestion_batch_counts_nonnegative CHECK (
    imported_events >= 0
    AND imported_results >= 0
    AND rejected_records >= 0
  )
);

CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  actor_label text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_action_not_empty CHECK (char_length(btrim(action)) > 0),
  CONSTRAINT audit_logs_entity_type_not_empty CHECK (char_length(btrim(entity_type)) > 0)
);

CREATE INDEX events_public_schedule_idx
  ON public.events (starts_at DESC)
  WHERE is_public = true;

CREATE INDEX registrations_event_status_idx
  ON public.registrations (event_id, status);

CREATE INDEX results_event_finish_idx
  ON public.results (event_id, finish_position);

CREATE INDEX results_driver_idx
  ON public.results (driver_id, event_id);

CREATE INDEX safety_stats_driver_idx
  ON public.safety_stats (driver_id, event_id);

CREATE INDEX penalties_event_driver_idx
  ON public.penalties (event_id, driver_id);

CREATE INDEX penalties_public_status_idx
  ON public.penalties (event_id, status)
  WHERE status IN ('published', 'served');

CREATE INDEX driver_ratings_circuit_class_idx
  ON public.driver_ratings (circuit_key, performance_class, safety_class);

CREATE INDEX auth_sessions_active_idx
  ON public.auth_sessions (driver_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER drivers_set_updated_at
BEFORE UPDATE ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER driver_identities_set_updated_at
BEFORE UPDATE ON public.driver_identities
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER events_set_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER registrations_set_updated_at
BEFORE UPDATE ON public.registrations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER results_set_updated_at
BEFORE UPDATE ON public.results
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER safety_stats_set_updated_at
BEFORE UPDATE ON public.safety_stats
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER penalties_set_updated_at
BEFORE UPDATE ON public.penalties
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER driver_ratings_set_updated_at
BEFORE UPDATE ON public.driver_ratings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- No INSERT, UPDATE or DELETE permission is granted to browser roles.
-- All sensitive mutations will pass through verified Edge Functions.
REVOKE ALL ON TABLE public.drivers FROM anon, authenticated;
REVOKE ALL ON TABLE public.driver_identities FROM anon, authenticated;
REVOKE ALL ON TABLE public.driver_roles FROM anon, authenticated;
REVOKE ALL ON TABLE public.events FROM anon, authenticated;
REVOKE ALL ON TABLE public.registrations FROM anon, authenticated;
REVOKE ALL ON TABLE public.results FROM anon, authenticated;
REVOKE ALL ON TABLE public.safety_stats FROM anon, authenticated;
REVOKE ALL ON TABLE public.penalties FROM anon, authenticated;
REVOKE ALL ON TABLE public.driver_ratings FROM anon, authenticated;
REVOKE ALL ON TABLE public.auth_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.ingestion_batches FROM anon, authenticated;
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;

GRANT SELECT ON TABLE public.drivers TO anon, authenticated;
GRANT SELECT ON TABLE public.events TO anon, authenticated;
GRANT SELECT ON TABLE public.registrations TO anon, authenticated;
GRANT SELECT ON TABLE public.results TO anon, authenticated;
GRANT SELECT ON TABLE public.safety_stats TO anon, authenticated;
GRANT SELECT ON TABLE public.penalties TO anon, authenticated;
GRANT SELECT ON TABLE public.driver_ratings TO anon, authenticated;

CREATE POLICY drivers_public_read
ON public.drivers
FOR SELECT
TO anon, authenticated
USING (is_profile_public = true);

CREATE POLICY events_public_read
ON public.events
FOR SELECT
TO anon, authenticated
USING (is_public = true AND status <> 'draft');

CREATE POLICY registrations_public_read
ON public.registrations
FOR SELECT
TO anon, authenticated
USING (
  status = 'confirmed'
  AND EXISTS (
    SELECT 1
    FROM public.events event_row
    WHERE event_row.id = registrations.event_id
      AND event_row.is_public = true
      AND event_row.status <> 'draft'
  )
  AND EXISTS (
    SELECT 1
    FROM public.drivers driver_row
    WHERE driver_row.id = registrations.driver_id
      AND driver_row.is_profile_public = true
  )
);

CREATE POLICY results_public_read
ON public.results
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events event_row
    WHERE event_row.id = results.event_id
      AND event_row.is_public = true
      AND event_row.status <> 'draft'
  )
  AND EXISTS (
    SELECT 1
    FROM public.drivers driver_row
    WHERE driver_row.id = results.driver_id
      AND driver_row.is_profile_public = true
  )
);

CREATE POLICY safety_stats_public_read
ON public.safety_stats
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events event_row
    WHERE event_row.id = safety_stats.event_id
      AND event_row.is_public = true
      AND event_row.status <> 'draft'
  )
  AND EXISTS (
    SELECT 1
    FROM public.drivers driver_row
    WHERE driver_row.id = safety_stats.driver_id
      AND driver_row.is_profile_public = true
  )
);

CREATE POLICY penalties_public_read
ON public.penalties
FOR SELECT
TO anon, authenticated
USING (
  status IN ('published', 'served')
  AND EXISTS (
    SELECT 1
    FROM public.events event_row
    WHERE event_row.id = penalties.event_id
      AND event_row.is_public = true
      AND event_row.status <> 'draft'
  )
  AND EXISTS (
    SELECT 1
    FROM public.drivers driver_row
    WHERE driver_row.id = penalties.driver_id
      AND driver_row.is_profile_public = true
  )
);

CREATE POLICY driver_ratings_public_read
ON public.driver_ratings
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.drivers driver_row
    WHERE driver_row.id = driver_ratings.driver_id
      AND driver_row.is_profile_public = true
  )
);

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.driver_identities IS
  'Private Steam identity data. Never grant browser roles direct access.';

COMMENT ON TABLE public.auth_sessions IS
  'Private hashed session records used by the Steam authentication Edge Functions.';

COMMENT ON TABLE public.ingestion_batches IS
  'Idempotency and audit records for future ACC CRM imports.';

COMMENT ON COLUMN public.driver_ratings.circuit_key IS
  'Use overall for the global rating or an ACC circuit key for a circuit-specific rating.';

COMMIT;
