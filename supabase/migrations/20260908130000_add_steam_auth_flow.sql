BEGIN;

-- Short-lived, one-time records used by the Steam OpenID login flow.
-- Only HMAC digests are stored: raw states, exchange codes and session tokens
-- exist in the browser for the shortest practical time.

CREATE TABLE public.auth_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  return_path text NOT NULL DEFAULT '/profil-pilote.html',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT auth_login_attempts_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT auth_login_attempts_return_path
    CHECK (return_path ~ '^/[A-Za-z0-9/_-]*[A-Za-z0-9_-](\.html)?$')
);

CREATE TABLE public.auth_exchange_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT auth_exchange_codes_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_login_attempts_active_idx
  ON public.auth_login_attempts (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX auth_exchange_codes_active_idx
  ON public.auth_exchange_codes (expires_at) WHERE consumed_at IS NULL;

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_exchange_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_login_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE public.auth_exchange_codes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_auth_login_attempt(p_state_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows integer;
BEGIN
  UPDATE public.auth_login_attempts
  SET consumed_at = now()
  WHERE state_hash = p_state_hash AND consumed_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_auth_exchange_code(p_code_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  consumed_driver_id uuid;
BEGIN
  UPDATE public.auth_exchange_codes
  SET consumed_at = now()
  WHERE code_hash = p_code_hash AND consumed_at IS NULL AND expires_at > now()
  RETURNING driver_id INTO consumed_driver_id;
  RETURN consumed_driver_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_steam_driver(
  p_steam_id64 text,
  p_persona_name text,
  p_profile_url text,
  p_avatar_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resolved_driver_id uuid;
  safe_display_name text;
BEGIN
  IF p_steam_id64 !~ '^[0-9]{17}$' THEN
    RAISE EXCEPTION 'Invalid SteamID64';
  END IF;

  safe_display_name := left(COALESCE(NULLIF(btrim(p_persona_name), ''), 'Steam Driver'), 64);
  SELECT driver_id INTO resolved_driver_id
  FROM public.driver_identities WHERE steam_id64 = p_steam_id64;

  IF resolved_driver_id IS NULL THEN
    BEGIN
      INSERT INTO public.drivers (display_name, avatar_url)
      VALUES (safe_display_name, p_avatar_url)
      RETURNING id INTO resolved_driver_id;

      INSERT INTO public.driver_identities (
        driver_id, steam_id64, steam_persona_name, steam_profile_url,
        steam_avatar_url, last_login_at
      ) VALUES (
        resolved_driver_id, p_steam_id64, safe_display_name, p_profile_url,
        p_avatar_url, now()
      );
    EXCEPTION WHEN unique_violation THEN
      SELECT driver_id INTO resolved_driver_id
      FROM public.driver_identities WHERE steam_id64 = p_steam_id64;
    END;
  END IF;

  IF resolved_driver_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve Steam driver';
  END IF;

  UPDATE public.drivers
  SET display_name = safe_display_name, avatar_url = p_avatar_url
  WHERE id = resolved_driver_id;

  UPDATE public.driver_identities
  SET steam_persona_name = safe_display_name,
      steam_profile_url = p_profile_url,
      steam_avatar_url = p_avatar_url,
      last_login_at = now()
  WHERE driver_id = resolved_driver_id;

  INSERT INTO public.driver_roles (driver_id, role)
  VALUES (resolved_driver_id, 'driver')
  ON CONFLICT (driver_id, role) DO NOTHING;

  RETURN resolved_driver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_auth_login_attempt(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_auth_exchange_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_steam_driver(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_login_attempt(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_auth_exchange_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_steam_driver(text, text, text, text) TO service_role;

COMMENT ON TABLE public.auth_login_attempts IS
  'Private, short-lived HMAC digests for Steam OpenID state validation.';
COMMENT ON TABLE public.auth_exchange_codes IS
  'Private, one-time HMAC digests exchanged by GitHub Pages for an ATX session.';

COMMIT;
