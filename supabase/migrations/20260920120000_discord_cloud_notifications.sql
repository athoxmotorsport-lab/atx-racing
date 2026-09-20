-- Discord ATX Racing : livraison automatique et conditionnelle.
-- Deux secrets Vault, à configurer UNE SEULE FOIS via l'interface Supabase :
-- atx_discord_webhook_url, atx_discord_pilot_role_id.
-- Aucun webhook ou jeton n'est enregistré dans le dépôt public.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE TABLE IF NOT EXISTS atx_private.discord_dispatch (
 notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
 request_id bigint,
 queued_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE atx_private.discord_dispatch FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION atx_private.enqueue_discord_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, atx_private, net, vault AS $$
DECLARE
 webhook_url text;
 role_id text;
 body jsonb;
 queued_id bigint;
BEGIN
 SELECT decrypted_secret INTO webhook_url FROM vault.decrypted_secrets WHERE name='atx_discord_webhook_url';
 SELECT decrypted_secret INTO role_id FROM vault.decrypted_secrets WHERE name='atx_discord_pilot_role_id';
 -- Tant que le bon salon et le bon rôle n'ont pas été explicitement configurés,
 -- ne rien envoyer, sans perturber les notifications du site.
 IF webhook_url IS NULL OR role_id IS NULL THEN RETURN NEW; END IF;
 IF webhook_url !~ '^https://(discord\.com|discordapp\.com)/api/(v[0-9]+/)?webhooks/[0-9]{17,22}/[A-Za-z0-9_-]+$'
    OR role_id !~ '^[0-9]{17,22}$' THEN
   RETURN NEW;
 END IF;
 IF NEW.related_link !~ '^(course\.html\?event=[a-z0-9-]+|classement\.html#circuit)$' THEN
   RETURN NEW;
 END IF;
 body := jsonb_build_object(
   'username', 'ATX Racing',
   'content', '<@&'||role_id||'> '||E'\n'||'🔔 **'||NEW.title_fr||'**'||
      E'\n'||NEW.message_fr||E'\n'||'https://athoxmotorsport-lab.github.io/atx-racing/'||NEW.related_link,
   'allowed_mentions', jsonb_build_object(
      'parse', jsonb_build_array(),
      'roles', jsonb_build_array(role_id)
   )
 );
 SELECT net.http_post(
   url := webhook_url, body := body,
   headers := '{"Content-Type":"application/json"}'::jsonb,
   timeout_milliseconds := 5000
 ) INTO queued_id;
 INSERT INTO atx_private.discord_dispatch(notification_id,request_id) VALUES(NEW.id,queued_id)
 ON CONFLICT(notification_id) DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Jamais laisser une panne Discord bloquer l'import des résultats ACC.
 RAISE LOG 'ATX Discord enqueue error for notice %', NEW.id;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION atx_private.enqueue_discord_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS atx_enqueue_discord_notification ON public.notifications;
CREATE TRIGGER atx_enqueue_discord_notification AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION atx_private.enqueue_discord_notification();
COMMIT;