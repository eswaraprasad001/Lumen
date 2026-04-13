create extension if not exists pgcrypto;

-- ── Custom schema ─────────────────────────────────────────────────────────
-- After running this, go to Supabase Dashboard → Settings → API →
-- "Exposed schemas" and add "lumen" so PostgREST can serve it.
create schema if not exists lumen;

-- Grant PostgREST access to the lumen schema.
-- Required even after adding the schema to "Exposed schemas" in the dashboard.
grant usage on schema lumen to anon, authenticated, service_role;
grant all on all tables in schema lumen to anon, authenticated, service_role;
grant all on all routines in schema lumen to anon, authenticated, service_role;
grant all on all sequences in schema lumen to anon, authenticated, service_role;
alter default privileges for role postgres in schema lumen grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema lumen grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema lumen grant all on sequences to anon, authenticated, service_role;

-- ── Tables ────────────────────────────────────────────────────────────────

create table if not exists lumen.email_accounts (
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

create table if not exists lumen.newsletter_sources (
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
  check (not (include_rule and exclude_rule)),
  priority_level text not null default 'normal' check (priority_level in ('core', 'normal', 'muted')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_sender_email)
);

create table if not exists lumen.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid not null references lumen.email_accounts(id) on delete cascade,
  source_id uuid not null references lumen.newsletter_sources(id) on delete cascade,
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
  -- Reading state (merged from user_message_states)
  state text not null default 'new' check (state in ('new', 'opened', 'in_progress', 'finished')),
  progress_percent integer not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  saved boolean not null default false,
  archived boolean not null default false,
  opened_at timestamptz,
  last_read_at timestamptz,
  finished_at timestamptz,
  last_scroll_position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, internet_message_id)
);

create table if not exists lumen.message_bodies (
  message_id uuid primary key references lumen.messages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  html_content text,
  text_content text,
  sanitized_html_content text,
  extracted_readable_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lumen.sender_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_type text not null check (rule_type in ('sender_email', 'sender_domain')),
  value text not null,
  action text not null check (action in ('include', 'exclude')),
  source_label text,
  synced_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, rule_type, value)
);

create table if not exists lumen.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_account_id uuid references lumen.email_accounts(id) on delete cascade,
  sync_type text not null default 'manual' check (sync_type in ('manual', 'backfill', 'scheduled')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  cursor text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists lumen.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Migrations (idempotent) ───────────────────────────────────────────────

alter table lumen.sender_rules add column if not exists synced_at timestamptz;
alter table lumen.sender_rules add column if not exists active boolean not null default true;
alter table lumen.newsletter_sources add column if not exists logo_url text;
alter table lumen.message_bodies add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table lumen.message_bodies add column if not exists raw_html_content text;

-- Issue 14: pruned_at timestamp to track when body content was erased
alter table lumen.message_bodies add column if not exists pruned_at timestamptz;

-- Issue 17: FK from messages → sync_jobs (the sync run that last ingested the message)
alter table lumen.messages add column if not exists sync_job_id uuid references lumen.sync_jobs(id) on delete set null;

-- Issue 18: key_version on email_accounts for future key rotation
alter table lumen.email_accounts add column if not exists key_version integer not null default 1;

-- Issue 12: add result counters and sync mode to sync_jobs
alter table lumen.sync_jobs add column if not exists messages_processed integer not null default 0;
alter table lumen.sync_jobs add column if not exists messages_inserted  integer not null default 0;
alter table lumen.sync_jobs add column if not exists messages_skipped   integer not null default 0;
alter table lumen.sync_jobs add column if not exists sync_mode          text;

-- Issue 13: maintained message_count on newsletter_sources
alter table lumen.newsletter_sources add column if not exists message_count integer not null default 0;

-- Backfill existing counts
update lumen.newsletter_sources ns
set message_count = (
  select count(*) from lumen.messages m where m.source_id = ns.id
)
where exists (select 1 from lumen.messages m where m.source_id = ns.id);

-- Issue 8: FK from sender_rules → newsletter_sources
alter table lumen.sender_rules add column if not exists source_id uuid references lumen.newsletter_sources(id) on delete set null;

do $$ begin
  if exists (
    select 1 from lumen.message_bodies where user_id is null limit 1
  ) then
    update lumen.message_bodies
    set user_id = m.user_id
    from lumen.messages m
    where m.id = lumen.message_bodies.message_id
      and lumen.message_bodies.user_id is null;
  end if;
end $$;

-- Issue 5: make message_bodies.user_id NOT NULL now that backfill has run
alter table lumen.message_bodies alter column user_id set not null;

-- Issue 9: scope provider_message_id uniqueness to (user_id, provider_message_id)
-- Drop the global unique constraint, add user-scoped one
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'messages_provider_message_id_key'
      and conrelid = 'lumen.messages'::regclass
  ) then
    alter table lumen.messages drop constraint messages_provider_message_id_key;
  end if;
end $$;
create unique index if not exists idx_messages_user_provider_message_id
  on lumen.messages (user_id, provider_message_id);

-- Issue 2: Remove 'saved'/'archived' from state enum — backfill legacy rows
-- then drop and recreate the check constraint with the narrower allowed set.
update lumen.messages set state = 'finished' where state = 'saved';
update lumen.messages set state = 'new'      where state = 'archived';

do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'messages_state_check'
      and conrelid = 'lumen.messages'::regclass
  ) then
    alter table lumen.messages drop constraint messages_state_check;
  end if;
end $$;
alter table lumen.messages
  add constraint messages_state_check
  check (state in ('new', 'opened', 'in_progress', 'finished'));

-- ── Indexes ───────────────────────────────────────────────────────────────

create index if not exists idx_email_accounts_user_id
  on lumen.email_accounts (user_id);

create index if not exists idx_messages_user_id
  on lumen.messages (user_id);

create index if not exists idx_messages_user_received_at
  on lumen.messages (user_id, received_at desc);

create index if not exists idx_messages_user_source_received_at
  on lumen.messages (user_id, source_id, received_at desc);

create index if not exists idx_newsletter_sources_user_email
  on lumen.newsletter_sources (user_id, normalized_sender_email);

create index if not exists idx_newsletter_sources_user_domain
  on lumen.newsletter_sources (user_id, normalized_sender_domain);

create index if not exists idx_messages_user_state
  on lumen.messages (user_id, state);

create index if not exists idx_messages_user_saved
  on lumen.messages (user_id) where saved = true;

create index if not exists idx_messages_user_archived
  on lumen.messages (user_id) where archived = true;

create index if not exists idx_sender_rules_user_rule
  on lumen.sender_rules (user_id, rule_type, value);

create index if not exists idx_message_bodies_user_id
  on lumen.message_bodies (user_id);

create index if not exists idx_sync_jobs_user_created
  on lumen.sync_jobs (user_id, created_at desc);

create index if not exists idx_sync_jobs_user_status
  on lumen.sync_jobs (user_id, status);

create index if not exists idx_messages_search_subject_snippet
  on lumen.messages using gin (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(snippet, '')));

create index if not exists idx_message_bodies_search_text
  on lumen.message_bodies using gin (to_tsvector('english', extracted_readable_text))
  where extracted_readable_text is not null;

-- ── updated_at trigger function ───────────────────────────────────────────

create or replace function lumen.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_email_accounts_updated_at on lumen.email_accounts;
create trigger trg_email_accounts_updated_at
before update on lumen.email_accounts
for each row execute procedure lumen.set_updated_at();

drop trigger if exists trg_newsletter_sources_updated_at on lumen.newsletter_sources;
create trigger trg_newsletter_sources_updated_at
before update on lumen.newsletter_sources
for each row execute procedure lumen.set_updated_at();

drop trigger if exists trg_messages_updated_at on lumen.messages;
create trigger trg_messages_updated_at
before update on lumen.messages
for each row execute procedure lumen.set_updated_at();

drop trigger if exists trg_message_bodies_updated_at on lumen.message_bodies;
create trigger trg_message_bodies_updated_at
before update on lumen.message_bodies
for each row execute procedure lumen.set_updated_at();

drop trigger if exists trg_sender_rules_updated_at on lumen.sender_rules;
create trigger trg_sender_rules_updated_at
before update on lumen.sender_rules
for each row execute procedure lumen.set_updated_at();

-- Issue 13: increment/decrement message_count on newsletter_sources via trigger
create or replace function lumen.update_source_message_count()
returns trigger
language plpgsql
security definer
set search_path = lumen
as $$
begin
  if TG_OP = 'INSERT' and NEW.source_id is not null then
    update lumen.newsletter_sources set message_count = message_count + 1 where id = NEW.source_id;
  elsif TG_OP = 'DELETE' and OLD.source_id is not null then
    update lumen.newsletter_sources set message_count = greatest(0, message_count - 1) where id = OLD.source_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_messages_source_count on lumen.messages;
create trigger trg_messages_source_count
after insert or delete on lumen.messages
for each row execute procedure lumen.update_source_message_count();

drop trigger if exists trg_profiles_updated_at on lumen.profiles;
create trigger trg_profiles_updated_at
before update on lumen.profiles
for each row execute procedure lumen.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────

alter table lumen.email_accounts enable row level security;
alter table lumen.newsletter_sources enable row level security;
alter table lumen.messages enable row level security;
alter table lumen.message_bodies enable row level security;
alter table lumen.sender_rules enable row level security;
alter table lumen.sync_jobs enable row level security;
alter table lumen.profiles enable row level security;

drop policy if exists "email_accounts_own_rows" on lumen.email_accounts;
create policy "email_accounts_own_rows" on lumen.email_accounts
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "newsletter_sources_own_rows" on lumen.newsletter_sources;
create policy "newsletter_sources_own_rows" on lumen.newsletter_sources
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "messages_own_rows" on lumen.messages;
create policy "messages_own_rows" on lumen.messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "message_bodies_own_rows" on lumen.message_bodies;
create policy "message_bodies_own_rows" on lumen.message_bodies
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sender_rules_own_rows" on lumen.sender_rules;
create policy "sender_rules_own_rows" on lumen.sender_rules
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sync_jobs_own_rows" on lumen.sync_jobs;
create policy "sync_jobs_own_rows" on lumen.sync_jobs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profiles_own_rows" on lumen.profiles;
create policy "profiles_own_rows" on lumen.profiles
for select using (auth.uid() = id);

-- ── Index for sender_rules.source_id FK ──────────────────────────────────

create index if not exists idx_sender_rules_source_id
  on lumen.sender_rules (source_id)
  where source_id is not null;

-- ── RPC: delete_user_data ─────────────────────────────────────────────────
-- Atomically deletes all newsletter data for a user while keeping their
-- account and Gmail connection intact.  Called by the "Delete data" action.

create or replace function lumen.delete_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = lumen
as $$
begin
  -- Delete rules and sources (messages + bodies cascade via FK)
  delete from lumen.sender_rules   where user_id = p_user_id;
  delete from lumen.newsletter_sources where user_id = p_user_id;
  delete from lumen.sync_jobs      where user_id = p_user_id;

  -- Reset sync state so next sync does a full lookback
  update lumen.email_accounts
  set last_synced_at = null,
      history_id     = null,
      last_error     = null
  where user_id = p_user_id;
end;
$$;

-- Allow authenticated users to call this function (RLS on tables still applies
-- inside the function because security definer runs as the function owner, but
-- the where user_id = p_user_id filters enforce correct scoping).
grant execute on function lumen.delete_user_data(uuid) to authenticated, service_role;

-- ── RPC: search_messages ─────────────────────────────────────────────────
-- Full-text search using GIN index + websearch_to_tsquery (safe, no injection).
-- Returns up to 50 messages ranked by ts_rank across subject, sender, snippet.

create or replace function lumen.search_messages(p_user_id uuid, p_query text)
returns table (
  id                  uuid,
  source_id           uuid,
  subject             text,
  from_name           text,
  from_email          text,
  snippet             text,
  sent_at             timestamptz,
  received_at         timestamptz,
  unsubscribe_url     text,
  state               text,
  progress_percent    integer,
  saved               boolean,
  archived            boolean,
  last_scroll_position integer,
  display_name        text,
  category            text,
  logo_url            text
)
language sql
stable
security definer
set search_path = lumen
as $$
  select
    m.id,
    m.source_id,
    m.subject,
    m.from_name,
    m.from_email,
    m.snippet,
    m.sent_at,
    m.received_at,
    m.unsubscribe_url,
    m.state,
    m.progress_percent,
    m.saved,
    m.archived,
    m.last_scroll_position,
    s.display_name,
    s.category,
    s.logo_url
  from lumen.messages m
  left join lumen.newsletter_sources s on s.id = m.source_id
  where m.user_id = p_user_id
    and (
      to_tsvector('english', coalesce(m.subject, '') || ' ' || coalesce(m.from_name, '') || ' ' || coalesce(m.from_email, '') || ' ' || coalesce(m.snippet, ''))
      @@ websearch_to_tsquery('english', p_query)
    )
  order by
    ts_rank(
      to_tsvector('english', coalesce(m.subject, '') || ' ' || coalesce(m.from_name, '') || ' ' || coalesce(m.from_email, '') || ' ' || coalesce(m.snippet, '')),
      websearch_to_tsquery('english', p_query)
    ) desc,
    m.received_at desc
  limit 50;
$$;

grant execute on function lumen.search_messages(uuid, text) to authenticated, service_role;

-- GIN index for full-text search across key message fields
create index if not exists idx_messages_fts
  on lumen.messages
  using gin (
    to_tsvector('english',
      coalesce(subject, '') || ' ' ||
      coalesce(from_name, '') || ' ' ||
      coalesce(from_email, '') || ' ' ||
      coalesce(snippet, '')
    )
  );

-- ── Admin aggregation RPCs ────────────────────────────────────────────────

-- State distribution across all messages (admin only, service_role)
create or replace function lumen.admin_reading_state_counts()
returns table (state text, cnt bigint)
language sql
stable
security definer
set search_path = lumen
as $$
  select state, count(*) as cnt
  from lumen.messages
  group by state;
$$;
grant execute on function lumen.admin_reading_state_counts() to service_role;

-- Messages received per day for the last N days (admin only)
create or replace function lumen.admin_messages_per_day(days_back integer default 30)
returns table (day date, cnt bigint)
language sql
stable
security definer
set search_path = lumen
as $$
  select
    date_trunc('day', received_at)::date as day,
    count(*) as cnt
  from lumen.messages
  where received_at >= now() - (days_back || ' days')::interval
  group by 1
  order by 1;
$$;
grant execute on function lumen.admin_messages_per_day(integer) to service_role;

-- Top newsletter sources by number of distinct users subscribed
create or replace function lumen.admin_top_sources(limit_n integer default 8)
returns table (
  domain      text,
  name        text,
  user_count  bigint,
  msg_count   bigint
)
language sql
stable
security definer
set search_path = lumen
as $$
  select
    ns.normalized_sender_domain as domain,
    max(ns.display_name)        as name,
    count(distinct ns.user_id)  as user_count,
    sum(ns.message_count)       as msg_count
  from lumen.newsletter_sources ns
  group by ns.normalized_sender_domain
  order by user_count desc, msg_count desc
  limit limit_n;
$$;
grant execute on function lumen.admin_top_sources(integer) to service_role;

-- ── Comments ──────────────────────────────────────────────────────────────

comment on schema lumen is 'Lumen app — newsletter reader data';

comment on table lumen.message_bodies is
'Keep full newsletter bodies only for the recent retention window. Older rows may be pruned to metadata-only content by the app sync process.';

-- ── Super admin promotion ─────────────────────────────────────────────────
-- To promote a user:
--   insert into lumen.profiles (id, role) values ('<user-uuid>', 'super_admin')
--   on conflict (id) do update set role = 'super_admin';
