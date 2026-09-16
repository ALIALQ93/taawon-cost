-- Taawon Cost — Supabase schema (free plan)
-- Run once in: Supabase Dashboard → SQL Editor → New query

create extension if not exists "pgcrypto";

-- ---------- roles ----------
create type public.app_role as enum ('viewer', 'reviewer', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  item_code text primary key,
  status text not null check (status in ('confirmed', 'manual_cost', 'no_match', 'duplicate_def')),
  albayan_idx integer,
  cost_override numeric,
  reviewed_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint reviews_payload_ok check (
    (status = 'confirmed' and albayan_idx is not null and cost_override is null)
    or (status = 'manual_cost' and albayan_idx is null and cost_override is not null and cost_override > 0)
    or (status = 'no_match' and albayan_idx is null and cost_override is null)
    or (status = 'duplicate_def' and albayan_idx is null and cost_override is null)
  )
);

create index reviews_updated_at_idx on public.reviews (updated_at desc);

-- ---------- helpers ----------
create or replace function public.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'viewer'::public.app_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() = 'admin';
$$;

create or replace function public.can_review()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() in ('reviewer', 'admin');
$$;

-- Auto-create profile on signup (default: viewer)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

-- Enforce write rules on reviews
create or replace function public.enforce_review_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.app_role := public.my_role();
begin
  if r = 'viewer' then
    raise exception 'viewer cannot modify reviews';
  end if;

  if tg_op = 'DELETE' then
    if r <> 'admin' and r <> 'reviewer' then
      raise exception 'not allowed';
    end if;
    return old;
  end if;

  -- Only admin may set / change manual cost
  if r <> 'admin' then
    if new.status = 'manual_cost' then
      raise exception 'only admin can set manual cost';
    end if;
    if new.cost_override is not null then
      raise exception 'only admin can set cost_override';
    end if;
    if tg_op = 'UPDATE' then
      new.cost_override := old.cost_override;
      if old.status = 'manual_cost' and new.status <> 'manual_cost' and r <> 'admin' then
        -- reviewer may clear / replace a manual-cost row only if admin allows — keep simple: block
        raise exception 'only admin can change a manual_cost review';
      end if;
    end if;
  end if;

  new.reviewed_by := auth.uid();
  return new;
end;
$$;

create trigger reviews_enforce_write
  before insert or update or delete on public.reviews
  for each row execute function public.enforce_review_write();

-- Only admin can change roles (from the app).
-- SQL Editor / service role have auth.uid() = null — allow bootstrap there.
create or replace function public.enforce_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'cannot change profile id';
  end if;

  if new.role is distinct from old.role then
    -- Bootstrap / dashboard SQL (no JWT): allow
    if auth.uid() is null then
      return new;
    end if;
    if not public.is_admin() then
      raise exception 'only admin can change roles';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_enforce_role
  before update on public.profiles
  for each row execute function public.enforce_profile_role_change();

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.reviews enable row level security;

-- Profiles: each user reads own row; admin reads all; users update own name only
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_insert_own_viewer on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'viewer');

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Reviews: authenticated can read; cost_override stripped for non-admin via view below
create policy reviews_select_auth on public.reviews
  for select to authenticated
  using (true);

create policy reviews_insert_reviewers on public.reviews
  for insert to authenticated
  with check (public.can_review());

create policy reviews_update_reviewers on public.reviews
  for update to authenticated
  using (public.can_review())
  with check (public.can_review());

create policy reviews_delete_reviewers on public.reviews
  for delete to authenticated
  using (public.can_review());

-- Safe view: hides cost_override from non-admin
create or replace view public.reviews_visible
with (security_invoker = true)
as
select
  item_code,
  status,
  albayan_idx,
  case when public.is_admin() then cost_override else null end as cost_override,
  reviewed_by,
  updated_at
from public.reviews;

grant select on public.reviews_visible to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant usage on type public.app_role to authenticated;

-- ---------- bootstrap first admin ----------
-- From SQL Editor (auth.uid() is null), role updates are allowed after the fix above.
-- 1) Create the user in Authentication → Users
-- 2) Run (replace the email):
--    update public.profiles set role = 'admin' where id = (
--      select id from auth.users where email = 'you@example.com'
--    );
