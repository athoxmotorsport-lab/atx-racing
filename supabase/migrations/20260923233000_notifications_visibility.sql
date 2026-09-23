-- ATX Racing: distinguish public notifications from internal notifications.
-- Existing notices keep visibility='public'; all direct writes remain service-only.
BEGIN;
ALTER TABLE public.notifications
  ADD COLUMN visibility text NOT NULL DEFAULT 'public'
  CONSTRAINT notifications_visibility_check CHECK (visibility IN ('public', 'internal'));
CREATE OR REPLACE FUNCTION atx_private.classify_notification_visibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, atx_private AS $$
BEGIN
  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = NEW.event_id AND e.is_public IS TRUE AND e.status <> 'draft'
  ) THEN
    NEW.visibility := 'internal';
  END IF;
  IF NEW.driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = NEW.driver_id AND d.is_profile_public IS TRUE
  ) THEN
    NEW.visibility := 'internal';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION atx_private.classify_notification_visibility()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER atx_classify_notification_visibility
BEFORE INSERT OR UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION atx_private.classify_notification_visibility();
DROP POLICY IF EXISTS atx_notifications_read_all ON public.notifications;
CREATE POLICY atx_notifications_public_read ON public.notifications
FOR SELECT TO anon, authenticated
USING (
  visibility = 'public'
  AND (
    event_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = notifications.event_id
        AND e.is_public IS TRUE AND e.status <> 'draft'
    )
  )
  AND (
    driver_id IS NULL OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = notifications.driver_id AND d.is_profile_public IS TRUE
    )
  )
);
-- The BEFORE trigger classifies private notices before Discord dispatch.
DROP TRIGGER IF EXISTS atx_enqueue_discord_notification ON public.notifications;
CREATE TRIGGER atx_enqueue_discord_notification
AFTER INSERT ON public.notifications
FOR EACH ROW WHEN (NEW.visibility = 'public')
EXECUTE FUNCTION atx_private.enqueue_discord_notification();
COMMIT;
