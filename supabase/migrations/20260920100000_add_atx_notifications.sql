-- Notifications ATX Racing : événement, record de circuit, rappel du jour.
-- Le client public peut lire, mais jamais créer ni modifier une notification.
BEGIN;
CREATE SCHEMA IF NOT EXISTS atx_private;
REVOKE ALL ON SCHEMA atx_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 type text NOT NULL CHECK (type IN ('race_day','results_published','circuit_record')),
 dedupe_key text NOT NULL UNIQUE,
 event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 circuit_key text,
 best_lap_ms integer,
 title_fr text NOT NULL,
 title_en text NOT NULL,
 message_fr text NOT NULL,
 message_en text NOT NULL,
 related_link text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS atx_notifications_latest_idx ON public.notifications (created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO anon, authenticated;
CREATE POLICY atx_notifications_read_all ON public.notifications FOR SELECT TO anon, authenticated USING (true);
-- Toutes les opérations d'écriture viennent de triggers internes.
CREATE OR REPLACE FUNCTION atx_private.publish_results_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, atx_private AS $$
BEGIN
 IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.is_public = true
    AND EXISTS (SELECT 1 FROM public.results r WHERE r.event_id = NEW.id) THEN
  INSERT INTO public.notifications(type,dedupe_key,event_id,title_fr,title_en,message_fr,message_en,related_link)
  VALUES ('results_published','results:'||NEW.id,NEW.id,
    'Résultats publiés · '||NEW.circuit_name,'Results published · '||NEW.circuit_name,
    'Les résultats officiels de '||NEW.title_fr||' sont disponibles.',
    'Official results for '||NEW.title_en||' are available.',
    'course.html?event='||NEW.slug)
  ON CONFLICT (dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION atx_private.publish_results_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS atx_results_notification ON public.events;
CREATE TRIGGER atx_results_notification AFTER UPDATE OF status ON public.events
FOR EACH ROW EXECUTE FUNCTION atx_private.publish_results_notification();

-- Le Collector marque le lot comme « processed » une fois TOUS les temps chargés.
-- Ne pas déclencher un record sur chaque pilote durant un import.
CREATE OR REPLACE FUNCTION atx_private.publish_record_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, atx_private AS $$
DECLARE
 v_session public.acc_sessions%ROWTYPE;
 v_event public.events%ROWTYPE;
 v_best record;
 v_previous integer;
 v_clock text;
BEGIN
 IF NEW.status <> 'processed' OR OLD.status IS NOT DISTINCT FROM NEW.status
    OR NEW.source <> 'atx-racing-collector' THEN RETURN NEW; END IF;
 SELECT * INTO v_session FROM public.acc_sessions WHERE payload_checksum = NEW.payload_checksum;
 IF NOT FOUND OR v_session.session_type NOT IN ('FP','Q','R') THEN RETURN NEW; END IF;
 SELECT * INTO v_event FROM public.events WHERE id = v_session.event_id;
 IF NOT FOUND OR v_event.is_official IS NOT TRUE OR v_event.circuit_key IS NULL THEN RETURN NEW; END IF;
 SELECT sr.driver_id, sr.best_lap_ms, d.display_name
 INTO v_best
 FROM public.acc_session_results sr JOIN public.drivers d ON d.id = sr.driver_id
 WHERE sr.session_id = v_session.id AND sr.best_lap_ms > 0
 ORDER BY sr.best_lap_ms, sr.id LIMIT 1;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT min(sr.best_lap_ms) INTO v_previous
 FROM public.acc_session_results sr
 JOIN public.acc_sessions s ON s.id = sr.session_id
 JOIN public.events e ON e.id = s.event_id
 WHERE s.id <> v_session.id AND s.created_at < v_session.created_at
   AND e.circuit_key = v_event.circuit_key AND e.is_official = true
   AND s.session_type IN ('FP','Q','R') AND sr.best_lap_ms > 0;
 -- La première référence d'un circuit n'est pas un record « battu ».
 IF v_previous IS NULL OR v_best.best_lap_ms >= v_previous THEN RETURN NEW; END IF;
 v_clock := (v_best.best_lap_ms / 60000)::text||':'||
   lpad(((v_best.best_lap_ms / 1000) % 60)::text,2,'0')||'.'||
   lpad((v_best.best_lap_ms % 1000)::text,3,'0');
 INSERT INTO public.notifications(type,dedupe_key,event_id,driver_id,circuit_key,best_lap_ms,
   title_fr,title_en,message_fr,message_en,related_link)
 VALUES ('circuit_record','record:'||v_session.id,v_event.id,v_best.driver_id,v_event.circuit_key,v_best.best_lap_ms,
   'Nouveau record · '||v_event.circuit_name,'New record · '||v_event.circuit_name,
   v_best.display_name||' a battu la référence sur '||v_event.circuit_name||' : '||v_clock||' ('||v_session.session_type||').',
   v_best.display_name||' set a new reference at '||v_event.circuit_name||' : '||v_clock||' ('||v_session.session_type||').',
   'classement.html#circuit')
 ON CONFLICT (dedupe_key) DO NOTHING;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION atx_private.publish_record_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS atx_record_notification ON public.ingestion_batches;
CREATE TRIGGER atx_record_notification AFTER UPDATE OF status ON public.ingestion_batches
FOR EACH ROW EXECUTE FUNCTION atx_private.publish_record_notification();

CREATE OR REPLACE FUNCTION atx_private.publish_race_day_notifications()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, atx_private AS $$
DECLARE v_count integer;
BEGIN
 -- Un seul passage par jour, à 9h locales, été et hiver compris.
 IF (now() AT TIME ZONE 'Europe/Brussels')::time NOT BETWEEN time '09:00' AND time '09:59:59' THEN
  RETURN 0;
 END IF;
 INSERT INTO public.notifications(type,dedupe_key,event_id,title_fr,title_en,message_fr,message_en,related_link)
 SELECT 'race_day','race-day:'||e.id||':'||(e.starts_at AT TIME ZONE 'Europe/Brussels')::date,
   e.id,'Course aujourd’hui · '||e.circuit_name,'Race today · '||e.circuit_name,
   e.title_fr||' est programmée aujourd’hui. Retrouvez les horaires et inscriptions.',
   e.title_en||' is scheduled for today. See times and registration.',
   'course.html?event='||e.slug
 FROM public.events e
 WHERE e.is_public = true AND e.status NOT IN ('completed','cancelled','draft')
   AND e.simgrid_url IS NOT NULL
   AND (e.starts_at AT TIME ZONE 'Europe/Brussels')::date = (now() AT TIME ZONE 'Europe/Brussels')::date
   AND e.starts_at + make_interval(mins => GREATEST(COALESCE(e.duration_minutes,60),60) + 120) > now()
 ON CONFLICT (dedupe_key) DO NOTHING;
 GET DIAGNOSTICS v_count = ROW_COUNT;
 RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION atx_private.publish_race_day_notifications() FROM PUBLIC, anon, authenticated;
COMMIT;