-- CryptChain Explorer: Supabase schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query), then put your project URL and
-- anon key in js/config.js. Row-level security makes every row visible only to its owner.

create table if not exists public.watchlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  chain_id    text not null check (char_length(chain_id) <= 40),
  address     text not null check (char_length(address) <= 128),
  label       text not null default '' check (char_length(label) <= 80),
  created_at  timestamptz not null default now(),
  unique (user_id, chain_id, address)
);

create table if not exists public.investigations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  address     text not null check (char_length(address) <= 128),
  chain_ids   text[] not null default '{}',
  params      jsonb not null default '{}',
  summary     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists watchlist_user_idx on public.watchlist (user_id, created_at desc);
create index if not exists investigations_user_idx on public.investigations (user_id, created_at desc);

alter table public.watchlist enable row level security;
alter table public.investigations enable row level security;

-- Owners can read, add, change and delete only their own rows
create policy "watchlist: owner" on public.watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "investigations: owner" on public.investigations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep each account's lists bounded
create or replace function public.limit_rows() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'watchlist' and (select count(*) from public.watchlist where user_id = new.user_id) >= 100 then
    raise exception 'Watchlist limit reached (100 wallets)';
  end if;
  if tg_table_name = 'investigations' and (select count(*) from public.investigations where user_id = new.user_id) >= 200 then
    raise exception 'Saved investigation limit reached (200)';
  end if;
  return new;
end $$;

drop trigger if exists watchlist_limit on public.watchlist;
create trigger watchlist_limit before insert on public.watchlist for each row execute function public.limit_rows();
drop trigger if exists investigations_limit on public.investigations;
create trigger investigations_limit before insert on public.investigations for each row execute function public.limit_rows();

-- Custom address labels (e.g. an exchange deposit address or a Dogecoin exchange wallet the user knows)
create table if not exists public.labels (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  chain_id    text not null check (char_length(chain_id) <= 40),
  address     text not null check (char_length(address) <= 128),
  name        text not null check (char_length(name) between 1 and 60),
  category    text not null default 'exchange' check (category in ('exchange', 'fund', 'custodian', 'issuer', 'exploit', 'other')),
  country     text check (country is null or char_length(country) <= 8),
  created_at  timestamptz not null default now(),
  unique (user_id, chain_id, address)
);
create index if not exists labels_user_idx on public.labels (user_id, created_at desc);
alter table public.labels enable row level security;
create policy "labels: owner" on public.labels for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
