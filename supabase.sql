
-- Messages table
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  username text not null,
  text text not null,
  created_at timestamptz default now()
);

-- RLS
alter table public.messages enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='Public read'
  ) then
    create policy "Public read" on public.messages for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='messages' and policyname='Public insert'
  ) then
    create policy "Public insert" on public.messages for insert with check (true);
  end if;
end $$;

-- Prune function: keep newest N
create or replace function public.prune_old_messages(keep_count int)
returns void as $$
begin
  delete from public.messages
  where id not in (
    select id from public.messages order by created_at desc limit keep_count
  );
end;
$$ language plsql;
