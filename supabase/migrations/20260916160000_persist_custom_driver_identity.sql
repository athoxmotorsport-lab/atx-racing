BEGIN;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS custom_display_name text,
  ADD COLUMN IF NOT EXISTS custom_avatar_url text;

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
  FROM public.driver_identities
  WHERE steam_id64 = p_steam_id64;

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
      FROM public.driver_identities
      WHERE steam_id64 = p_steam_id64;
    END;
  END IF;

  IF resolved_driver_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve Steam driver';
  END IF;

  UPDATE public.drivers
  SET display_name = COALESCE(custom_display_name, safe_display_name),
      avatar_url = COALESCE(custom_avatar_url, p_avatar_url)
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

REVOKE ALL ON FUNCTION public.upsert_steam_driver(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_steam_driver(text, text, text, text)
  TO service_role;

COMMIT;
