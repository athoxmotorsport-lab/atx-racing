alter table public.events
  add column if not exists car_class text not null default 'GT3',
  add column if not exists schedule_timezone_label text not null default 'Europe/Brussels',
  add column if not exists event_schedule jsonb not null default '[]'::jsonb,
  add column if not exists mandatory_pit_stop boolean not null default false,
  add column if not exists mandatory_tyre_change boolean not null default false,
  add column if not exists mandatory_refuelling boolean not null default false,
  add column if not exists fixed_refuelling_seconds integer,
  add column if not exists time_multiplier numeric(4,1) not null default 1;

alter table public.events
  drop constraint if exists events_car_class_length,
  add constraint events_car_class_length check (char_length(car_class) between 1 and 32),
  drop constraint if exists events_schedule_timezone_label_length,
  add constraint events_schedule_timezone_label_length check (char_length(schedule_timezone_label) between 1 and 32),
  drop constraint if exists events_event_schedule_array,
  add constraint events_event_schedule_array check (jsonb_typeof(event_schedule) = 'array'),
  drop constraint if exists events_fixed_refuelling_seconds_range,
  add constraint events_fixed_refuelling_seconds_range check (fixed_refuelling_seconds is null or fixed_refuelling_seconds between 0 and 600),
  drop constraint if exists events_time_multiplier_range,
  add constraint events_time_multiplier_range check (time_multiplier between 1 and 24);

comment on column public.events.event_schedule is
  'Public race-day schedule. Array of validated objects containing key, bilingual labels and HH:MM start/end values.';

comment on column public.events.schedule_timezone_label is
  'Display label used for the schedule and Discord reminder, for example UTC+2.';

