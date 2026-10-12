-- Run in Supabase Dashboard -> SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / drop-and-recreate for policies.

-- ---------------------------------------------------------------
-- 1. Raw sensor readings (written by the ESP32)
-- ---------------------------------------------------------------
create table if not exists public.water_quality_data (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  device_id     text not null default 'esp32-tank-01',
  tds_adc       integer,
  tds_voltage   real,
  tds_ppm       real,
  temperature   real,
  water_status  text,
  rssi          integer
);

-- Columns added by the upgraded firmware (no-ops on a fresh table)
alter table public.water_quality_data add column if not exists device_id   text not null default 'esp32-tank-01';
alter table public.water_quality_data add column if not exists tds_voltage real;
alter table public.water_quality_data add column if not exists tds_ppm     real;
alter table public.water_quality_data add column if not exists rssi        integer;

create index if not exists wqd_device_time_idx
  on public.water_quality_data (device_id, created_at desc);

-- ---------------------------------------------------------------
-- 2. ML results (written by the FastAPI backend with the secret key)
-- ---------------------------------------------------------------
create table if not exists public.ml_predictions (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  reading_id       bigint references public.water_quality_data(id) on delete cascade,
  device_id        text not null,
  quality_score    real,          -- 0-100, higher is better
  quality_label    text,          -- EXCELLENT / GOOD / FAIR / POOR / UNSAFE
  is_anomaly       boolean,
  anomaly_score    real,          -- higher = more unusual
  sensor_fault     text,          -- null when healthy
  forecast_tds_ppm real,          -- predicted TDS ~1 hour ahead
  model_version    text
);

create unique index if not exists mlp_reading_uidx on public.ml_predictions (reading_id);
create index if not exists mlp_device_time_idx on public.ml_predictions (device_id, created_at desc);

-- ---------------------------------------------------------------
-- 3. Row Level Security
--    anon/publishable key: ESP32 may INSERT readings; dashboard may SELECT.
--    secret key (backend) bypasses RLS entirely.
-- ---------------------------------------------------------------
alter table public.water_quality_data enable row level security;
alter table public.ml_predictions     enable row level security;

drop policy if exists "device insert"  on public.water_quality_data;
drop policy if exists "public read"    on public.water_quality_data;
drop policy if exists "public read ml" on public.ml_predictions;

create policy "device insert" on public.water_quality_data
  for insert to anon
  with check (
    tds_adc between 0 and 4095
    and (temperature is null or temperature between -55 and 125)
  );

create policy "public read" on public.water_quality_data
  for select to anon, authenticated using (true);

create policy "public read ml" on public.ml_predictions
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------
-- 4. Realtime: push new rows to the React dashboard
-- ---------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.water_quality_data;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.ml_predictions;
  exception when duplicate_object then null;
  end;
end $$;
