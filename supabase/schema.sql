create table public.finance_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('transaction', 'business', 'installment', 'note', 'savings_goal', 'savings_transfer', 'budget', 'category', 'app_state')),
  record_id text not null,
  payload jsonb not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_type, record_id)
);

create index finance_records_owner_type on public.finance_records (user_id, record_type) where deleted_at is null;
alter table public.finance_records enable row level security;
grant select, insert, update, delete on public.finance_records to authenticated;

create policy "Users read their finance records" on public.finance_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their finance records" on public.finance_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update their finance records" on public.finance_records
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users delete their finance records" on public.finance_records
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.whatsapp_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wa_id text not null unique,
  linked_at timestamptz not null default now()
);
alter table public.whatsapp_links enable row level security;
revoke all on public.whatsapp_links from public, anon, authenticated;
grant all on public.whatsapp_links to service_role;

create table public.whatsapp_link_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_link_codes enable row level security;
grant select, insert, update on public.whatsapp_link_codes to authenticated;
create policy "Users read their link code status" on public.whatsapp_link_codes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their link code" on public.whatsapp_link_codes
  for insert to authenticated with check ((select auth.uid()) = user_id and used_at is null and expires_at > now());
create policy "Users rotate their link code" on public.whatsapp_link_codes
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and used_at is null and expires_at > now());

create table public.whatsapp_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wa_id text not null,
  message_id text not null unique,
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending', 'confirmed', 'cancelled')),
  transaction_record_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  completed_at timestamptz
);
create index whatsapp_pending_owner_recent on public.whatsapp_pending (wa_id, created_at desc) where state = 'pending';
alter table public.whatsapp_pending enable row level security;
revoke all on public.whatsapp_pending from public, anon, authenticated;
grant all on public.whatsapp_pending to service_role;

create table public.whatsapp_events (
  message_id text primary key,
  wa_id text not null,
  message_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text
);
alter table public.whatsapp_events enable row level security;
revoke all on public.whatsapp_events from public, anon, authenticated;
grant all on public.whatsapp_events to service_role;

