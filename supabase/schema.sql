create extension if not exists pgcrypto;

create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_account_id text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  email_address text not null,
  sync_enabled boolean not null default true,
  history_id text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  unique (user_id, provider_account_id)
);

create table if not exists public.newsletter_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_sender_email text not null,
  normalized_sender_domain text not null,
  display_name text,
  description text,
  category text,
  logo_url text,
  include_rule boolean not null default false,
  exclude_rule boolean not null default false,
  priority_level text not null default 'normal' check (priority_level in ('core', 'normal', 'muted')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_sender_email)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  source_id uuid not null references public.newsletter_sources(id) on delete cascade,
  provider_message_id text not null unique,
  provider_thread_id text not null,
  internet_message_id text not null,
  subject text not null,
  from_name text,
  from_email text not null,
  sent_at timestamptz not null,
  received_at timestamptz not null,
  snippet text,
  unsubscribe_url text,
  raw_headers_json jsonb not null default '{}'::jsonb,
  detection_method text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, internet_message_id)
);

create table if not exists public.message_bodies (
  message_id uuid primary key references public.messages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  html_content text,
  text_content text,
  sanitized_html_content text,
  extracted_readable_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);




create table if not exists public.user_message_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  state text not null default 'new' check (state in ('new', 'opened', 'in_progress', 'saved', 'finished', 'archived')),
  progress_percent integer not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  saved boolean not null default false,
  archived boolean not null default false,
  opened_at timestamptz,
  last_read_at timestamptz,
  finished_at timestamptz,
  last_scroll_position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create table if not exists public.sender_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_type text not null check (rule_type in ('sender_email', 'sender_domain')),
  value text not null,
  action text not null check (action in ('include', 'exclude')),
  source_label text,
  synced_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration: add synced_at to existing sender_rules tables
alter table public.sender_rules add column if not exists synced_at timestamptz;

-- Migration: add active flag to sender_rules
alter table public.sender_rules add column if not exists active boolean not null default true;

-- Migration: add logo_url to existing newsletter_sources tables
alter table public.newsletter_sources add column if not exists logo_url text;

-- Migration: add user_id to message_bodies for direct RLS (eliminates EXISTS subquery)
alter table public.message_bodies add column if not exists user_id uuid references auth.users(id) on delete cascade;
update public.message_bodies set user_id = m.user_id from public.messages m where m.id = public.message_bodies.message_id and public.message_bodies.user_id is null;
create index if not exists idx_message_bodies_user_id on public.message_bodies (user_id);

create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid references public.email_accounts(id) on delete cascade,
  sync_type text not null default 'manual',
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  cursor text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_user_received_at
  on public.messages (user_id, received_at desc);

create index if not exists idx_messages_user_source_received_at
  on public.messages (user_id, source_id, received_at desc);

create index if not exists idx_newsletter_sources_user_email
  on public.newsletter_sources (user_id, normalized_sender_email);

create index if not exists idx_newsletter_sources_user_domain
  on public.newsletter_sources (user_id, normalized_sender_domain);

create index if not exists idx_user_message_states_user_state
  on public.user_message_states (user_id, state);

create index if not exists idx_sender_rules_user_rule
  on public.sender_rules (user_id, rule_type, value);

create index if not exists idx_messages_search_subject_snippet
  on public.messages using gin (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(snippet, '')));

create index if not exists idx_message_bodies_search_text
  on public.message_bodies using gin (to_tsvector('english', coalesce(extracted_readable_text, '')));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_email_accounts_updated_at on public.email_accounts;
create trigger trg_email_accounts_updated_at
before update on public.email_accounts
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_newsletter_sources_updated_at on public.newsletter_sources;
create trigger trg_newsletter_sources_updated_at
before update on public.newsletter_sources
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_messages_updated_at on public.messages;
create trigger trg_messages_updated_at
before update on public.messages
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_message_bodies_updated_at on public.message_bodies;
create trigger trg_message_bodies_updated_at
before update on public.message_bodies
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_user_message_states_updated_at on public.user_message_states;
create trigger trg_user_message_states_updated_at
before update on public.user_message_states
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_sender_rules_updated_at on public.sender_rules;
create trigger trg_sender_rules_updated_at
before update on public.sender_rules
for each row execute procedure public.set_updated_at();

alter table public.email_accounts enable row level security;
alter table public.newsletter_sources enable row level security;
alter table public.messages enable row level security;
alter table public.message_bodies enable row level security;
alter table public.user_message_states enable row level security;
alter table public.sender_rules enable row level security;
alter table public.sync_jobs enable row level security;

drop policy if exists "email_accounts_own_rows" on public.email_accounts;
create policy "email_accounts_own_rows"
on public.email_accounts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "newsletter_sources_own_rows" on public.newsletter_sources;
create policy "newsletter_sources_own_rows"
on public.newsletter_sources
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "messages_own_rows" on public.messages;
create policy "messages_own_rows"
on public.messages
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "message_bodies_via_messages" on public.message_bodies;
drop policy if exists "message_bodies_own_rows" on public.message_bodies;
create policy "message_bodies_own_rows"
on public.message_bodies
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_message_states_own_rows" on public.user_message_states;
create policy "user_message_states_own_rows"
on public.user_message_states
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "sender_rules_own_rows" on public.sender_rules;
create policy "sender_rules_own_rows"
on public.sender_rules
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "sync_jobs_own_rows" on public.sync_jobs;
create policy "sync_jobs_own_rows"
on public.sync_jobs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_own_rows" on public.profiles;
create policy "profiles_own_rows"
on public.profiles
for select
using (auth.uid() = id);

-- Migration: add profiles table
-- To make a user super_admin run:
--   insert into public.profiles (id, role) values ('<user-uuid>', 'super_admin')
--   on conflict (id) do update set role = 'super_admin';

comment on table public.message_bodies is
'Keep full newsletter bodies only for the recent retention window. Older rows may be pruned to metadata-only content by the app sync process.';



{# insert into public.profiles (id, role) values ('<user-uuid>', 'super_admin')
on conflict (id) do update set role = 'super_admin'; #}
