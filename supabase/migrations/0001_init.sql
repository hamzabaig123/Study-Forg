-- StudyForge: initial schema, row level security, and the token-addressed surface.
--
-- Mirrors the archive the app keeps today in localStorage under
-- `studyforge.mock-backend.v1` (MockDb in src/frontend/src/mocks/backend.ts),
-- with three deliberate differences:
--
--   1. every row carries `owner_id`, and RLS restricts it to `auth.uid()`. Two
--      accounts in one browser share one archive today; that is impossible here.
--   2. the `nextId` counter is gone. Postgres issues ids, so the cross-tab
--      collision the mock patches over in `adoptForeignNextId` cannot occur.
--   3. grading, session sampling and link resolution are server-side functions.
--      A client can no longer report `correct: true` for its own answer or skip
--      a scan it does not want counted.
--
-- Timestamps are `timestamptz`; the domain layer uses nanosecond bigints
-- (`BigInt(ms) * 1_000_000n`), so the adapter converts in both directions.
--
-- Object order matters: sql-language function bodies are parsed when the
-- function is created, so every table and helper they reference is defined
-- above them.
--
-- After applying ANY migration in this folder, re-run the "harden roles" block
-- at the bottom. Supabase's template grants `anon` privileges on newly created
-- public tables by default, and `revoke ... from anon` only reaches tables that
-- already exist when it runs.

-- ---------------------------------------------------------------------------
-- Content hierarchy: class -> subject -> chapter -> topic -> question
-- ---------------------------------------------------------------------------

create table class (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table subject (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  class_id    bigint not null references class (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table chapter (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  subject_id  bigint not null references subject (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table topic (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  chapter_id  bigint not null references chapter (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- `answer` keeps the canister's tagged union unchanged
-- ({ __kind__: 'multipleChoice' | 'shortAnswer' | 'trueFalse', … }) so the
-- adapter needs no mapping layer, exactly like the mock: an MCQ question's
-- options live inside answer.multipleChoice.options, which is why there is no
-- separate options column here. The checks refuse a write that would produce a
-- question the player can never answer.
create table question (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  topic_id      bigint not null references topic (id) on delete cascade,
  prompt        text not null check (char_length(prompt) between 1 and 8000),
  question_type text not null check (question_type in ('shortAnswer', 'multipleChoice', 'trueFalse')),
  answer        jsonb not null check (jsonb_typeof(answer) = 'object' and answer ? '__kind__'),
  explanation   text check (explanation is null or char_length(explanation) <= 8000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (
    case answer ->> '__kind__'
      when 'multipleChoice' then jsonb_typeof(answer -> 'multipleChoice' -> 'options') = 'array'
                              and jsonb_array_length(answer -> 'multipleChoice' -> 'options') >= 2
                              and answer -> 'multipleChoice' ? 'correctOptionId'
      when 'shortAnswer'    then answer -> 'shortAnswer' ? 'expected'
      when 'trueFalse'      then answer -> 'trueFalse' ? 'correct'
      else false
    end
  ),
  check ((question_type = 'multipleChoice') = (answer ->> '__kind__' = 'multipleChoice'))
);

create index question_topic_idx on question (owner_id, topic_id, id);

-- ---------------------------------------------------------------------------
-- Sessions and results
--
-- The mock keeps the question snapshot inline in `records`/`results`. Child rows
-- make submitAnswer a one-row update instead of a rewrite of the whole session
-- blob, which is why two tabs on one session currently overwrite each other.
-- `options` here is the display-only copy (id + text, no correctOptionId), so
-- the player can be served question prompts without the answer.
-- ---------------------------------------------------------------------------

create table session (
  id               bigint generated always as identity primary key,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  mode             text not null check (mode in ('practice', 'timedTest')),
  scope_kind       text not null check (scope_kind in ('topic', 'chapter')),
  scope_id         bigint not null,
  scope_label      text not null check (char_length(scope_label) <= 200),
  started_at       timestamptz not null default now(),
  expires_at       timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 86400),
  completed_at     timestamptz
);

create index session_open_idx on session (owner_id, completed_at, started_at desc);

create table session_item (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  session_id    bigint not null references session (id) on delete cascade,
  position      integer not null check (position >= 0),
  question_id   bigint not null,
  topic_id      bigint not null,
  prompt        text not null,
  question_type text not null check (question_type in ('shortAnswer', 'multipleChoice', 'trueFalse')),
  options       jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  answer        jsonb not null check (jsonb_typeof(answer) = 'object' and answer ? '__kind__'),
  explanation   text,
  submitted     jsonb check (submitted is null or jsonb_typeof(submitted) = 'object'),
  correct       boolean,
  unique (session_id, position),
  check ((question_type = 'multipleChoice') = (answer ->> '__kind__' = 'multipleChoice'))
);

create index session_item_question_idx on session_item (session_id, question_id);

create table result (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  session_id   bigint references session (id) on delete set null,
  mode         text not null check (mode in ('practice', 'timedTest')),
  scope_kind   text not null check (scope_kind in ('topic', 'chapter')),
  scope_id     bigint not null,
  scope_label  text not null check (char_length(scope_label) <= 200),
  started_at   timestamptz not null,
  completed_at timestamptz not null default now(),
  score        integer not null check (score >= 0),
  total        integer not null check (total >= score)
);

create index result_recent_idx on result (owner_id, completed_at desc);

create table result_item (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  result_id      bigint not null references result (id) on delete cascade,
  position       integer not null check (position >= 0),
  question_id    bigint not null,
  prompt         text not null,
  question_type  text not null check (question_type in ('shortAnswer', 'multipleChoice', 'trueFalse')),
  correct_answer jsonb not null check (jsonb_typeof(correct_answer) = 'object' and correct_answer ? '__kind__'),
  explanation    text,
  submitted      jsonb check (submitted is null or jsonb_typeof(submitted) = 'object'),
  correct        boolean not null,
  unique (result_id, position)
);

-- ---------------------------------------------------------------------------
-- Notes, shares, links
-- ---------------------------------------------------------------------------

-- `document_json` is the editor document; `search_text` is derived from it and
-- indexed, because matching against the raw JSON also hits attribute names such
-- as "bulletList".
create table note (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 300),
  subject_label text,
  chapter_label text,
  topic_label   text,
  document_json jsonb not null check (jsonb_typeof(document_json) = 'object'),
  search_text   text not null default '',
  status        text not null default 'active' check (status in ('active', 'trashed')),
  revision      integer not null default 1 check (revision > 0),
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Trash is a product feature, so an active note must not carry a delete time
  -- and a trashed one must. Restore cannot be reasoned about otherwise.
  check ((status = 'trashed') = (deleted_at is not null))
);

create index note_list_idx on note (owner_id, status, updated_at desc);
create index note_search_idx on note using gin (to_tsvector('simple', search_text));

-- Share and edit tokens are stored as sha256 hex digests, computed in the client
-- (src/frontend/src/lib/supabase/tokens.ts). A token is a bearer credential
-- shown once at creation, so a database dump yields no usable link.
create table note_share (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  note_id    bigint not null references note (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table content_share (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  scope_kind text not null check (scope_kind in ('topic', 'chapter')),
  scope_id   bigint not null,
  created_at timestamptz not null default now()
);

create table link (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  code            text not null unique check (code ~ '^[2-9a-hjkmnp-z]{7}$'),
  edit_token_hash text not null unique check (edit_token_hash ~ '^[a-f0-9]{64}$'),
  target_url      text not null,
  status          text not null default 'active' check (status in ('active', 'paused', 'deleted')),
  abuse_count     integer not null default 0 check (abuse_count >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index link_owner_idx on link (owner_id, status, created_at desc);

create table link_scan (
  id       bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  link_id  bigint not null references link (id) on delete cascade,
  at       timestamptz not null default now(),
  device   text not null check (device in ('desktop', 'tablet', 'mobile', 'other')),
  country  text check (country is null or country ~ '^[A-Za-z]{2}$')
);

create index link_scan_link_idx on link_scan (link_id, at desc);
create index link_scan_owner_idx on link_scan (owner_id, at desc);

-- Report text is not study content, so it has no owner and no policy beyond the
-- implicit deny RLS gives it.
create table abuse_report (
  id     bigint generated always as identity primary key,
  code   text not null,
  reason text not null check (char_length(reason) between 1 and 2000),
  at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Activity feed, settings, AI drafts
-- ---------------------------------------------------------------------------

create table activity (
  id       bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  at       timestamptz not null default now(),
  kind     text not null check (char_length(kind) between 1 and 40),
  title    text not null check (char_length(title) between 1 and 300)
);

-- The only table that grows on every action, and the dashboard reads the newest
-- N rows from it on each load.
create index activity_recent_idx on activity (owner_id, at desc);

create table user_settings (
  owner_id     uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  study_goal   text not null default '' check (char_length(study_goal) <= 500),
  daily_target integer not null default 0 check (daily_target between 0 and 1000),
  appearance   text not null default 'system' check (appearance in ('system', 'light', 'dark')),
  updated_at   timestamptz not null default now()
);

-- The review queue is device-local today (studyforge.ai-studio.v2). Storing it
-- means a run started on one machine can be reviewed on another.
create table ai_draft (
  id                  uuid not null default gen_random_uuid() primary key,
  owner_id            uuid not null references auth.users (id) on delete cascade,
  source_file_name    text not null check (char_length(source_file_name) <= 300),
  source_extracted_at timestamptz not null default now(),
  position            integer not null check (position >= 0),
  page                integer check (page is null or page > 0),
  question_type       text not null check (question_type in ('shortAnswer', 'multipleChoice', 'trueFalse')),
  prompt              text not null check (char_length(prompt) between 1 and 8000),
  options             jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  answer              jsonb not null check (jsonb_typeof(answer) = 'object' and answer ? '__kind__'),
  explanation         text,
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'imported')),
  saved_question_id   bigint references question (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index ai_draft_owner_idx on ai_draft (owner_id, position);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger class_touch before update on class for each row execute function touch_updated_at();
create trigger subject_touch before update on subject for each row execute function touch_updated_at();
create trigger chapter_touch before update on chapter for each row execute function touch_updated_at();
create trigger topic_touch before update on topic for each row execute function touch_updated_at();
create trigger question_touch before update on question for each row execute function touch_updated_at();
create trigger note_touch before update on note for each row execute function touch_updated_at();
create trigger link_touch before update on link for each row execute function touch_updated_at();
create trigger user_settings_touch before update on user_settings for each row execute function touch_updated_at();
create trigger ai_draft_touch before update on ai_draft for each row execute function touch_updated_at();

create function host_refused() returns text
language sql
immutable
as $$
  select 'Links to private or local addresses are not allowed.';
$$;

-- Mirrors isPrivateHost() in the mock. Name-only checks are best effort: the
-- resolved-address case needs the Edge Function in Phase 5 to be sure.
create function private_host_problem(host text) returns text
language sql
immutable
as $$
  select case
    when host is null or btrim(host) = '' then 'URL is missing a host.'
    when lower(host) in ('localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', '0.0.0.0', '::', '::1')
      then host_refused()
    when lower(host) like '%.localhost' or lower(host) like '%.local' or lower(host) like '%.internal'
      then host_refused()
    -- IPv6 hosts arrive without their brackets (see url_target_problem).
    -- fc00::/7 unique-local and fe80::/10 link-local are private by definition.
    when host like '%:%' and lower(host) ~ '^(fc|fd|fe[89ab])' then host_refused()
    when host like '%:%' and lower(host) ~ '^(::1|::f{0,4}:)' then host_refused()
    -- IPv4 literals and the dotted forms of the reserved ranges.
    when split_part(host, '.', 1) = '127' or split_part(host, '.', 1) = '10' or split_part(host, '.', 1) = '0'
      then host_refused()
    when host like '192.168.%' or host like '169.254.%'
      then host_refused()
    when host like '172.16.%' or host like '172.17.%' or host like '172.18.%' or host like '172.19.%'
      or host like '172.2%.%' or host like '172.30.%' or host like '172.31.%'
      then host_refused()
    -- 100.64.0.0/10 shared address space (CGNAT).
    when host like '100.64.%' or host like '100.6%.%' or host like '100.7%.%' or host like '100.8%.%'
      or host like '100.9%.%' or host like '100.1[0-1]%' or host like '100.12[0-7].%'
      then host_refused()
    else null
  end;
$$;

-- The mock validates target URLs in TypeScript (`urlProblem`), which any caller
-- can bypass. Same rule set, enforced where the write happens.
create function url_target_problem(candidate text) returns text
language sql
immutable
as $$
  with parsed as (
    select btrim(coalesce(candidate, '')) as url,
           nullif(split_part(btrim(coalesce(candidate, '')), '://', 2), '') as rest
  ),
  hostpart as (
    select url, rest,
           case
             -- A bracketed IPv6 host contains colons, so take the host before the
             -- first '/' but keep the brackets intact.
             when rest like '[%' then split_part(substr(rest, 2), ']', 1) || ''
             else split_part(split_part(rest, '/', 1), ':', 1)
           end as host
      from parsed
  )
  select case
    when url = '' then 'Enter a URL to shorten.'
    when position('://' in url) = 0 then 'URL must start with http:// or https://'
    when lower(split_part(url, '://', 1)) not in ('http', 'https') then 'Only http and https links are allowed.'
    when btrim(host) = '' then 'URL is missing a host.'
    when char_length(url) > 2000 then 'URL is too long.'
    -- Credentials in the authority would let a link carry a fake host.
    when position('@' in split_part(rest, '/', 1)) > 0 then 'URLs must not embed credentials.'
    else private_host_problem(host)
  end
  from hostpart;
$$;

-- Mirrors normalizeText(): trim, collapse whitespace runs, casefold. Answers
-- that differ only in spacing are the same answer.
create function normalize_answer_text(value text) returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g'));
$$;

-- Mirrors isCorrectAnswer(): the submitted shape must match the expected shape,
-- then the payload is compared. One definition so a practice session and a
-- timed test cannot grade the same answer differently.
create function answer_is_correct(submitted jsonb, expected jsonb) returns boolean
language sql
immutable
as $$
  select case
    when submitted is null or expected is null then false
    when submitted ->> '__kind__' is distinct from expected ->> '__kind__' then false
    when submitted ->> '__kind__' = 'trueFalse' then
      (submitted -> 'trueFalse' ->> 'value')::boolean
      is not distinct from (expected -> 'trueFalse' ->> 'correct')::boolean
    when submitted ->> '__kind__' = 'shortAnswer' then
      normalize_answer_text(submitted -> 'shortAnswer' ->> 'text')
      = normalize_answer_text(expected -> 'shortAnswer' ->> 'expected')
      and normalize_answer_text(submitted -> 'shortAnswer' ->> 'text') <> ''
    when submitted ->> '__kind__' = 'multipleChoice' then
      (submitted -> 'multipleChoice' ->> 'optionId')
      = (expected -> 'multipleChoice' ->> 'correctOptionId')
    else false
  end;
$$;

-- What the player and the review screen read. `options` is the display copy
-- taken from the snapshot, so no correctOptionId can leak through it.
create function session_view(p_session_id bigint) returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', s.id,
           'mode', s.mode,
           'scopeKind', s.scope_kind,
           'scopeId', s.scope_id,
           'scopeLabel', s.scope_label,
           'startedAt', s.started_at,
           'expiresAt', s.expires_at,
           'durationSeconds', s.duration_seconds,
           'completedAt', s.completed_at,
           'questions', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', si.question_id,
                      'questionType', si.question_type,
                      'prompt', si.prompt,
                      'options', si.options,
                      'submitted', si.submitted,
                      'correct', si.correct)
                    order by si.position), '[]'::jsonb)
             from session_item si
            where si.session_id = s.id)
         )
    from session s
   where s.id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- Row level security: owner-only, everywhere.
--
-- Anonymous visitors reach shared content exclusively through the SECURITY
-- DEFINER functions below; no table is readable by `anon`.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'class', 'subject', 'chapter', 'topic', 'question',
    'session', 'session_item', 'result', 'result_item',
    'note', 'note_share', 'content_share',
    'link', 'link_scan', 'activity', 'user_settings', 'ai_draft'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);
    -- FORCE so the table owner is subject to the policies too; a later role
    -- change must not silently open the data.
    execute format('alter table %I force row level security', t);
    execute format('create policy owner_select_%I on %I for select to authenticated using (owner_id = auth.uid())', t, t);
    execute format('create policy owner_insert_%I on %I for insert to authenticated with check (owner_id = auth.uid())', t, t);
    execute format('create policy owner_update_%I on %I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t, t);
    execute format('create policy owner_delete_%I on %I for delete to authenticated using (owner_id = auth.uid())', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- The public (token-addressed) surface
--
-- SECURITY DEFINER so an anonymous visitor can resolve a share token while
-- `anon` holds no table privileges. Each function takes only a digest or a short
-- code, never an id, and returns the minimum a visitor needs. Every one pins
-- search_path so it cannot be hijacked by a shadowing object.
-- ---------------------------------------------------------------------------

create function shared_content(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_share content_share;
  v_payload jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into v_share from content_share where token_hash = p_token_hash;
  if not found then
    return null;
  end if;

  if v_share.scope_kind = 'topic' then
    select jsonb_build_object(
             'kind', 'topic',
             'name', tp.name,
             'description', tp.description,
             'breadcrumb', coalesce((
               select jsonb_build_array(c.name, s.name, ch.name)
                 from chapter ch
                 join subject s on s.id = ch.subject_id
                 join class c on c.id = s.class_id
                where ch.id = tp.chapter_id), '[]'::jsonb),
             'questions', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', q.id,
                        'questionType', q.question_type,
                        'prompt', q.prompt,
                        'options', coalesce(q.answer -> 'multipleChoice' -> 'options', '[]'::jsonb),
                        'answer', q.answer,
                        'explanation', q.explanation)
                      order by q.id)
                 from question q
                where q.topic_id = tp.id), '[]'::jsonb)
           )
      into v_payload
      from topic tp
     where tp.id = v_share.scope_id
       and tp.owner_id = v_share.owner_id;
  else
    select jsonb_build_object(
             'kind', 'chapter',
             'name', ch.name,
             'description', ch.description,
             'topics', coalesce((
               select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.id)
                 from topic t
                where t.chapter_id = ch.id), '[]'::jsonb)
           )
      into v_payload
      from chapter ch
     where ch.id = v_share.scope_id
       and ch.owner_id = v_share.owner_id;
  end if;

  if v_payload is null then
    -- The owner deleted the content but the share row outlived it: drop the
    -- dead share rather than hand back an empty shell.
    delete from content_share where token_hash = p_token_hash;
  end if;
  return v_payload;
end;
$$;

create function shared_note(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_share note_share;
  v_payload jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into v_share from note_share where token_hash = p_token_hash and revoked_at is null;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
           'title', n.title,
           'document', n.document_json,
           'subjectLabel', n.subject_label,
           'chapterLabel', n.chapter_label,
           'topicLabel', n.topic_label,
           'revision', n.revision,
           'updatedAt', n.updated_at
         )
    into v_payload
    from note n
   where n.id = v_share.note_id
     and n.status = 'active'
     and n.owner_id = v_share.owner_id;

  if v_payload is null then
    delete from note_share where token_hash = p_token_hash;
  end if;
  return v_payload;
end;
$$;

-- Resolving a short code is also the scan event, so a visitor who does not want
-- to be counted cannot skip the count.
create function resolve_link(p_code text, p_device text default 'other', p_country text default null) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link link;
begin
  select * into v_link from link where code = p_code;
  if not found then
    return jsonb_build_object('unavailable', 'notFound');
  end if;
  if v_link.status = 'deleted' then
    return jsonb_build_object('unavailable', 'deleted');
  end if;
  if v_link.status = 'paused' then
    return jsonb_build_object('unavailable', 'paused');
  end if;
  insert into link_scan (owner_id, link_id, device, country)
       values (v_link.owner_id, v_link.id,
               case when p_device in ('desktop', 'tablet', 'mobile', 'other') then p_device else 'other' end,
               nullif(p_country, ''));
  return jsonb_build_object('targetUrl', v_link.target_url);
end;
$$;

-- The /manage/:token page is reached by the link's holder with no login, so it
-- is keyed on the edit token digest rather than on owner_id.
create function link_detail_for_token(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link link;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into v_link from link where edit_token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_link.id,
    'status', v_link.status,
    'code', v_link.code,
    'targetUrl', v_link.target_url,
    'shortUrl', '/r/' || v_link.code,
    'createdAt', v_link.created_at,
    'updatedAt', v_link.updated_at
  );
end;
$$;

create function link_scan_stats_for_token(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link_id bigint;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select id into v_link_id from link where edit_token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'totalScans', (select count(*) from link_scan where link_id = v_link_id),
    'perDay', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'count', count) order by day)
        from (select to_char(at at time zone 'utc', 'YYYY-MM-DD') as day, count(*) as count
                from link_scan
               where link_id = v_link_id
               group by 1) daily), '[]'::jsonb)
  );
end;
$$;

create function link_set_paused(p_token_hash text, p_paused boolean) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update link set status = case when p_paused then 'paused' else 'active' end
   where edit_token_hash = p_token_hash
     and status <> 'deleted';
  if not found then
    return jsonb_build_object('err', 'notFound');
  end if;
  return jsonb_build_object('ok', link_detail_for_token(p_token_hash));
end;
$$;

create function link_update_target(p_token_hash text, p_target_url text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_problem text;
begin
  v_problem := url_target_problem(p_target_url);
  if v_problem is not null then
    return jsonb_build_object('err', jsonb_build_object('invalidUrl', v_problem));
  end if;
  update link set target_url = btrim(p_target_url)
   where edit_token_hash = p_token_hash
     and status <> 'deleted';
  if not found then
    return jsonb_build_object('err', 'notFound');
  end if;
  return jsonb_build_object('ok', link_detail_for_token(p_token_hash));
end;
$$;

-- Deletion is a status change, not a row removal: the code must keep resolving
-- as 'deleted' so a shared link stops pointing at content rather than returning
-- "not found" and inviting someone to claim the freed code.
create function link_delete(p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update link set status = 'deleted' where edit_token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('err', 'notFound');
  end if;
  return jsonb_build_object('ok', null);
end;
$$;

create function report_link_abuse(p_code text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_code is null or p_code = '' then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'A short code is required.'));
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'Describe the problem with this link.'));
  end if;
  update link set abuse_count = abuse_count + 1 where code = p_code;
  if not found then
    return jsonb_build_object('err', 'notFound');
  end if;
  insert into abuse_report (code, reason) values (p_code, btrim(p_reason));
  return jsonb_build_object('ok', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner-facing operations that must be atomic
-- ---------------------------------------------------------------------------

-- Sampling happens here so the client cannot choose which questions a session
-- contains, and so the prompt/options/answer snapshot is taken in the same
-- statement that creates the session.
create function start_session(
  p_mode text,
  p_scope_kind text,
  p_scope_id bigint,
  p_question_count integer default null,
  p_duration_seconds integer default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_label text;
  v_topic_ids bigint[];
  v_pool_size integer;
  v_session_id bigint;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_mode not in ('practice', 'timedTest') or p_scope_kind not in ('topic', 'chapter') then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'Unknown session mode or scope.'));
  end if;

  if p_scope_kind = 'topic' then
    select array_agg(tp.id) into v_topic_ids
      from topic tp
     where tp.id = p_scope_id
       and tp.owner_id = v_owner;
    select name into v_label from topic where id = p_scope_id and owner_id = v_owner;
  else
    select array_agg(tp.id) into v_topic_ids
      from topic tp
      join chapter ch on ch.id = tp.chapter_id
     where ch.id = p_scope_id
       and ch.owner_id = v_owner;
    select name into v_label from chapter where id = p_scope_id and owner_id = v_owner;
  end if;

  if v_topic_ids is null then
    return jsonb_build_object('err', jsonb_build_object('notFound', null));
  end if;

  select count(*) into v_pool_size
    from question q
   where q.owner_id = v_owner
     and q.topic_id = any (v_topic_ids);

  if v_pool_size = 0 then
    return jsonb_build_object('err', jsonb_build_object('noQuestions', null));
  end if;

  if p_mode = 'timedTest' then
    if p_duration_seconds is null or p_duration_seconds <= 0 then
      return jsonb_build_object('err', jsonb_build_object('invalidInput', 'durationSeconds is required for a timed test'));
    end if;
    if p_question_count is not null and p_question_count <= 0 then
      return jsonb_build_object('err', jsonb_build_object('invalidInput', 'questionCount must be greater than zero'));
    end if;
  end if;

  insert into session (owner_id, mode, scope_kind, scope_id, scope_label, started_at, expires_at, duration_seconds)
       values (v_owner, p_mode, p_scope_kind, p_scope_id, coalesce(v_label, 'Untitled'), now(),
               case when p_mode = 'timedTest' then now() + make_interval(secs => p_duration_seconds) end,
               p_duration_seconds)
  returning id into v_session_id;

  -- `limit null` means "all", so practice sessions take the whole pool and a
  -- timed test takes the smaller of its request and the pool.
  insert into session_item (owner_id, session_id, position, question_id, topic_id, prompt,
                            question_type, options, answer, explanation)
  select v_owner, v_session_id, row_number() over () - 1, q.id, q.topic_id, q.prompt,
         q.question_type,
         coalesce(q.answer -> 'multipleChoice' -> 'options', '[]'::jsonb),
         q.answer, q.explanation
    from question q
   where q.owner_id = v_owner
     and q.topic_id = any (v_topic_ids)
   order by q.id
   limit case when p_mode = 'timedTest' and p_question_count is not null
              then least(p_question_count, v_pool_size)
              else null end;

  return jsonb_build_object('ok', session_view(v_session_id));
end;
$$;

-- Grading is server-side: the client sends what the user answered and is told
-- whether it was right, so a modified client cannot record a perfect score.
create function submit_answer(p_session_id bigint, p_question_id bigint, p_submitted jsonb) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item session_item;
  v_session session;
  v_correct boolean;
begin
  select * into v_session from session where id = p_session_id and owner_id = auth.uid();
  if not found then
    return jsonb_build_object('err', jsonb_build_object('notFound', null));
  end if;
  if v_session.expires_at is not null and now() > v_session.expires_at then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'time has expired'));
  end if;

  select * into v_item
    from session_item
   where session_id = p_session_id
     and question_id = p_question_id;
  if not found then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'question is not part of this session'));
  end if;

  v_correct := answer_is_correct(p_submitted, v_item.answer);

  update session_item
     set submitted = p_submitted,
         correct = v_correct
   where id = v_item.id;

  return jsonb_build_object('ok', jsonb_build_object(
    'correct', v_correct,
    'correctAnswer', v_item.answer,
    'explanation', v_item.explanation
  ));
end;
$$;

-- Answers, the graded result, the feed entry and the session close either all
-- happen or none do, so a tab crashing mid-completion cannot lose a test.
create function complete_session(p_session_id bigint) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session session;
  v_result_id bigint;
  v_total integer;
  v_score integer;
begin
  select * into v_session from session where id = p_session_id and owner_id = auth.uid();
  if not found then
    return jsonb_build_object('err', jsonb_build_object('notFound', null));
  end if;
  if v_session.completed_at is not null then
    -- Idempotent: a retried completion must not create a second attempt.
    return jsonb_build_object('ok', jsonb_build_object(
             'resultId', (select id from result where session_id = p_session_id limit 1),
             'replayed', true));
  end if;

  select count(*), count(*) filter (where coalesce(correct, false))
    into v_total, v_score
    from session_item
   where session_id = p_session_id;

  insert into result (owner_id, session_id, mode, scope_kind, scope_id, scope_label,
                      started_at, completed_at, score, total)
       values (auth.uid(), p_session_id, v_session.mode, v_session.scope_kind, v_session.scope_id,
               v_session.scope_label, v_session.started_at, now(), v_score, v_total)
  returning id into v_result_id;

  insert into result_item (owner_id, result_id, position, question_id, prompt, question_type,
                           correct_answer, explanation, submitted, correct)
  select auth.uid(), v_result_id, si.position, si.question_id, si.prompt, si.question_type,
         si.answer, si.explanation, si.submitted, coalesce(si.correct, false)
    from session_item si
   where si.session_id = p_session_id;

  update session set completed_at = now() where id = p_session_id;

  insert into activity (owner_id, kind, title)
       values (auth.uid(), 'session',
               case when v_session.mode = 'timedTest' then 'Completed a timed test' else 'Completed a practice session' end);

  return jsonb_build_object('ok', jsonb_build_object('resultId', v_result_id, 'score', v_score, 'total', v_total));
end;
$$;

-- One round trip for the dashboard instead of four, and the figures agree
-- because they share one snapshot.
create function dashboard_stats() returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'classes', (select count(*) from class where owner_id = auth.uid()),
    'topics', (select count(*) from topic where owner_id = auth.uid()),
    'questions', (select count(*) from question where owner_id = auth.uid()),
    'notes', (select count(*) from note where owner_id = auth.uid() and status = 'active'),
    'attempts', (select count(*) from result where owner_id = auth.uid()),
    'answered', (select coalesce(sum(total), 0) from result where owner_id = auth.uid()),
    'correct', (select coalesce(sum(score), 0) from result where owner_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- Internal helpers stay invisible to the API; only the functions below are
-- reachable over PostgREST.
revoke all on function host_refused() from public;
revoke all on function private_host_problem(text) from public;
revoke all on function url_target_problem(text) from public;
revoke all on function normalize_answer_text(text) from public;
revoke all on function answer_is_correct(jsonb, jsonb) from public;

grant execute on function shared_content(text) to anon, authenticated;
grant execute on function shared_note(text) to anon, authenticated;
grant execute on function resolve_link(text, text, text) to anon, authenticated;
grant execute on function link_detail_for_token(text) to anon, authenticated;
grant execute on function link_scan_stats_for_token(text) to anon, authenticated;
grant execute on function link_set_paused(text, boolean) to anon, authenticated;
grant execute on function link_update_target(text, text) to anon, authenticated;
grant execute on function link_delete(text) to anon, authenticated;
grant execute on function report_link_abuse(text, text) to anon, authenticated;

grant execute on function start_session(text, text, bigint, integer, integer) to authenticated;
grant execute on function submit_answer(bigint, bigint, jsonb) to authenticated;
grant execute on function complete_session(bigint) to authenticated;
grant execute on function dashboard_stats() to authenticated;
grant execute on function session_view(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Harden roles. Repeat this block after every migration that creates a table.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Re-grant the anonymous surface the blanket revoke above just removed.
grant usage on schema public to anon;
grant execute on function shared_content(text) to anon;
grant execute on function shared_note(text) to anon;
grant execute on function resolve_link(text, text, text) to anon;
grant execute on function link_detail_for_token(text) to anon;
grant execute on function link_scan_stats_for_token(text) to anon;
grant execute on function link_set_paused(text, boolean) to anon;
grant execute on function link_update_target(text, text) to anon;
grant execute on function link_delete(text) to anon;
grant execute on function report_link_abuse(text, text) to anon;
