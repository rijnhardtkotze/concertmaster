-- Source: one place we fetch listings from, with its Source role and health.
-- Replaces data/source-status.json. The Source's config (URLs, adapter, selectors)
-- stays in code under sources/; fetch upserts this row on every run.

-- Nothing in public is readable by the anon or authenticated roles unless a migration
-- grants it. ADR 0004: the anon role gets select on the published views and nothing
-- else, so later migrations grant that per view. Row-level security below is the
-- second lock on each table.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- In order of authority: when Sources disagree on a field, the higher role wins.
create type public.source_role as enum ('presenter', 'venue', 'aggregator', 'vendor');

create table public.source (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) > 0),
  role public.source_role not null,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error text,
  -- The pipeline writes these in South African Standard Time (+02:00).
  last_attempt timestamptz,
  last_success timestamptz
);

comment on table public.source is 'One place we fetch listings from. Config lives in sources/; this row holds its Source role and health.';
comment on column public.source.role is 'Source role: presenter, venue, aggregator or vendor, in that order of authority.';
comment on column public.source.consecutive_failures is 'Runs in a row whose fetch failed. Three open a Source failing issue.';

alter table public.source enable row level security;

revoke all on table public.source from anon, authenticated;
