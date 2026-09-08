BEGIN;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS team_name text,
  ADD COLUMN IF NOT EXISTS twitch_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text,
  ADD COLUMN IF NOT EXISTS youtube_url text,
  ADD COLUMN IF NOT EXISTS website_url text;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_team_name_length CHECK (team_name IS NULL OR char_length(team_name) <= 64),
  ADD CONSTRAINT drivers_bio_fr_length CHECK (bio_fr IS NULL OR char_length(bio_fr) <= 500),
  ADD CONSTRAINT drivers_bio_en_length CHECK (bio_en IS NULL OR char_length(bio_en) <= 500),
  ADD CONSTRAINT drivers_twitch_url_https CHECK (twitch_url IS NULL OR twitch_url ~ '^https://(www\.)?twitch\.tv/'),
  ADD CONSTRAINT drivers_tiktok_url_https CHECK (tiktok_url IS NULL OR tiktok_url ~ '^https://(www\.)?tiktok\.com/'),
  ADD CONSTRAINT drivers_youtube_url_https CHECK (youtube_url IS NULL OR youtube_url ~ '^https://(www\.)?(youtube\.com|youtu\.be)/'),
  ADD CONSTRAINT drivers_website_url_https CHECK (website_url IS NULL OR website_url ~ '^https://');

COMMIT;
