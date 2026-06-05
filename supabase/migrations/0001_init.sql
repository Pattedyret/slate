-- 0001_init.sql

create table public.boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Board',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.objects (
  id          uuid primary key,                 -- client-generated (crypto.randomUUID)
  board_id    uuid not null references public.boards(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('stroke','line','rect','ellipse','arrow','text')),
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create index objects_board_idx on public.objects (board_id);
create index boards_owner_idx  on public.boards (owner_id, sort_order);

alter table public.boards  enable row level security;
alter table public.objects enable row level security;

create policy boards_select on public.boards for select to authenticated
  using ( (select auth.uid()) = owner_id );
create policy boards_insert on public.boards for insert to authenticated
  with check ( (select auth.uid()) = owner_id );
create policy boards_update on public.boards for update to authenticated
  using ( (select auth.uid()) = owner_id )
  with check ( (select auth.uid()) = owner_id );
create policy boards_delete on public.boards for delete to authenticated
  using ( (select auth.uid()) = owner_id );

create policy objects_select on public.objects for select to authenticated
  using ( (select auth.uid()) = owner_id );
create policy objects_insert on public.objects for insert to authenticated
  with check ( (select auth.uid()) = owner_id );
create policy objects_update on public.objects for update to authenticated
  using ( (select auth.uid()) = owner_id )
  with check ( (select auth.uid()) = owner_id );
create policy objects_delete on public.objects for delete to authenticated
  using ( (select auth.uid()) = owner_id );
