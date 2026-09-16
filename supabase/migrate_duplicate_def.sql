-- Add review status: duplicate_def (مادة معرفة بأكثر من أسلوب)
-- Run once in: Supabase Dashboard → SQL Editor

-- Drop old status / payload checks (names may vary)
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'reviews'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%status%'
  loop
    execute format('alter table public.reviews drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.reviews
  add constraint reviews_status_check
  check (status in ('confirmed', 'manual_cost', 'no_match', 'duplicate_def'));

alter table public.reviews
  add constraint reviews_payload_ok check (
    (status = 'confirmed' and albayan_idx is not null and cost_override is null)
    or (status = 'manual_cost' and albayan_idx is null and cost_override is not null and cost_override > 0)
    or (status = 'no_match' and albayan_idx is null and cost_override is null)
    or (status = 'duplicate_def' and albayan_idx is null and cost_override is null)
  );
