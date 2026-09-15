alter table public.drivers add column if not exists car_number text;
alter table public.drivers drop constraint if exists drivers_country_code_format;
alter table public.drivers add constraint drivers_country_code_format check (country_code is null or country_code ~ '^[A-Z]{2}$');
alter table public.drivers drop constraint if exists drivers_car_number_format;
alter table public.drivers add constraint drivers_car_number_format check (car_number is null or car_number ~ '^[A-Za-z0-9-]{1,4}$');
