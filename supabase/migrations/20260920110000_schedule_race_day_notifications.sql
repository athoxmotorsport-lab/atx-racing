-- Exécution côté Supabase : 9 h à Bruxelles, sans PC ni PowerShell.
-- 07:00 UTC en été, 08:00 UTC en hiver. La fonction ne travaille
-- qu'à 9h locales et la clé unique interdit les rappels en double.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
SELECT cron.schedule(
 'atx-race-day-9am-brussels',
 '0 7,8 * * *',
 $$SELECT atx_private.publish_race_day_notifications();$$
);