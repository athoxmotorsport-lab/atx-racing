-- ATX Racing notification visibility rollback: fail closed if data would be exposed.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    LEFT JOIN public.events e ON e.id = n.event_id
    LEFT JOIN public.drivers d ON d.id = n.driver_id
    WHERE n.visibility = 'internal'
       OR (n.event_id IS NOT NULL AND (e.id IS NULL OR e.is_public IS NOT TRUE OR e.status = 'draft'))
       OR (n.driver_id IS NOT NULL AND (d.id IS NULL OR d.is_profile_public IS NOT TRUE))
  ) THEN
    RAISE EXCEPTION 'Rollback refused: internal or hidden notifications exist';
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS atx_classify_notification_visibility ON public.notifications;
DROP TRIGGER IF EXISTS atx_enqueue_discord_notification ON public.notifications;
CREATE TRIGGER atx_enqueue_discord_notification
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION atx_private.enqueue_discord_notification();
DROP POLICY IF EXISTS atx_notifications_public_read ON public.notifications;
CREATE POLICY atx_notifications_read_all ON public.notifications
FOR SELECT TO anon, authenticated USING (true);
DROP FUNCTION IF EXISTS atx_private.classify_notification_visibility();
ALTER TABLE public.notifications DROP COLUMN visibility;
COMMIT;
