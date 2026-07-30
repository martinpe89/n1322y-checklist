-- N1322Y Checklist — Database Schema
-- Initial migration

create table if not exists partners (
  id          text primary key,
  name        text not null,
  pin_hash    text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists flights (
  id           text primary key,
  partner_id   text not null references partners(id),
  tail         text not null default 'N1322Y',
  started_at   timestamptz not null,
  closed_at    timestamptz,
  eng_start    numeric(7,1),
  eng_end      numeric(7,1),
  ac_start     numeric(7,1),
  ac_end       numeric(7,1),
  eng_hours    numeric(6,1) generated always as (eng_end - eng_start) stored,
  ac_hours     numeric(6,1) generated always as (ac_end - ac_start) stored,
  photo_start  text,
  photo_end    text,
  unchecked    int not null default 0,
  gap          numeric(6,1),
  device_id    text,
  created_at   timestamptz not null default now()
);

create table if not exists checks (
  flight_id  text not null references flights(id) on delete cascade,
  phase      int  not null,
  item       int  not null,
  checked_at timestamptz not null default now(),
  primary key (flight_id, phase, item)
);

create table if not exists settings (
  k text primary key,
  v text
);

create index if not exists flights_partner_idx on flights(partner_id, started_at desc);
create index if not exists flights_closed_idx on flights(closed_at desc) where closed_at is not null;
