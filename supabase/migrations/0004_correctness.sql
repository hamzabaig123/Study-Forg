-- 0004_correctness.sql
--
-- Nine fixes for states the schema allowed but the app cannot recover from.
-- Each one is a place where a concurrent call, a browser locale, or an
-- imported answer shape turns into either a wrong number on the user's own
-- analytics page or a page that says something untrue.
--
-- Apply after 0001. It is written to be correct with or without 0002/0003:
-- the throttle branches all check that enforce_rate_limit exists first, the
-- same way 0003's create_link does, so this file may be applied before them.

-- ---------------------------------------------------------------------------
-- 1. One result per session, in the schema rather than in the code.
-- ---------------------------------------------------------------------------
--
-- complete_session read the session row, inserted a result, and deleted the
-- session. Two tabs finishing the same test — or a timed run auto-finishing a
-- heartbeat before the Finish click lands — both passed the read, and both
-- inserted, because result_session_idx is a plain index. Two result rows for
-- one attempt makes analytics_breakdown count every result_item twice, so the
-- accuracy buckets drift upward with no visible cause.
--
-- Refuse rather than clean up: silently deleting the newer duplicate would
-- destroy an attempt the user actually made, and the count below is a signal
-- that it already happened.

do $$
declare
  v_dups integer;
begin
  select count(*) into v_dups
    from (select session_id from result group by session_id having count(*) > 1) d;
  if v_dups > 0 then
    raise exception
      '0004 stopped: % sessions already have more than one result row. '
      'Decide which attempt to keep for each (see: select session_id, count(*) '
      'from result group by session_id having count(*) > 1) and re-run.', v_dups;
  end if;
end;
$$;

create unique index result_session_uidx on result (session_id);

-- ---------------------------------------------------------------------------
-- 2. complete_session: take the row out of the race.
-- ---------------------------------------------------------------------------

create or replace function complete_session(p_session_id bigint) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_session session;
  v_result_id bigint;
  v_total integer;
  v_score integer;
begin
  -- FOR UPDATE is the whole fix: the second caller blocks here, and by the
  -- time it wakes the row is gone, so `not found` answers it truthfully. The
  -- unique index from step 1 is the backstop for two callers that somehow
  -- both get through, e.g. after a manual restore of an old session row.
  select * into v_session
    from session
   where id = p_session_id and owner_id = v_owner
   for update;
  if not found then
    -- Covers the second call too: the row is gone by then.
    return jsonb_build_object('err', jsonb_build_object('notFound', null));
  end if;

  select count(*), count(*) filter (where coalesce(correct, false))
    into v_total, v_score
    from session_item
   where session_id = p_session_id;

  insert into result (owner_id, session_id, mode, scope_kind, scope_id, scope_label,
                      started_at, completed_at, score, total)
       values (v_owner, p_session_id, v_session.mode, v_session.scope_kind, v_session.scope_id,
               v_session.scope_label, v_session.started_at, now(), v_score, v_total)
  returning id into v_result_id;

  insert into result_item (owner_id, result_id, position, question_id, prompt, question_type,
                           correct_answer, explanation, submitted, correct)
  select v_owner, v_result_id, si.position, si.question_id, si.prompt, si.question_type,
         si.answer, si.explanation, si.submitted, coalesce(si.correct, false)
    from session_item si
   where si.session_id = p_session_id;

  delete from session where id = p_session_id;

  insert into activity (owner_id, kind, title)
       values (v_owner, 'session',
               format('%s completed — %s/%s',
                      case when v_session.mode = 'timedTest' then 'Timed test' else 'Practice' end,
                      v_score, v_total));

  -- The session id, because that is what getSessionResult takes.
  return jsonb_build_object('ok', p_session_id);
exception
  when unique_violation then
    -- Only reachable through the index in step 1: this session was already
    -- completed by a call that won the lock. Say notFound, which is what the
    -- adapter already understands as "there is nothing left to finish".
    return jsonb_build_object('err', jsonb_build_object('notFound', null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. update_note: make the revision check hold.
-- ---------------------------------------------------------------------------
--
-- It read the revision, compared it, then wrote unconditionally. Two tabs
-- autosaving the same note with the same expected revision both read N, both
-- passed, and the second overwrote the first — the exact loss the
-- p_expected_revision argument exists to prevent, and the caller was told
-- nothing because no staleRevision was returned.

create or replace function update_note(
  p_id bigint,
  p_title text,
  p_subject_label text,
  p_chapter_label text,
  p_topic_label text,
  p_document_json text,
  p_search_text text,
  p_expected_revision integer
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_existing note;
  v_row note;
begin
  -- Locks the note for the length of this transaction, so the loser of a
  -- simultaneous save waits, re-reads the committed revision, and is answered
  -- with staleRevision instead of quietly winning.
  select * into v_existing
    from note
   where id = p_id and owner_id = v_owner
   for update;
  if not found then
    return jsonb_build_object('err', 'notFound');
  end if;
  if v_existing.revision <> p_expected_revision then
    return jsonb_build_object('err', jsonb_build_object('staleRevision', jsonb_build_object(
      'expected', p_expected_revision, 'actual', v_existing.revision)));
  end if;

  update note
     set title = p_title,
         subject_label = nullif(btrim(coalesce(p_subject_label, '')), ''),
         chapter_label = nullif(btrim(coalesce(p_chapter_label, '')), ''),
         topic_label = nullif(btrim(coalesce(p_topic_label, '')), ''),
         document_json = p_document_json,
         search_text = coalesce(p_search_text, ''),
         revision = revision + 1
   where id = p_id
     and revision = p_expected_revision
  returning * into v_row;

  if v_row is null then
    -- The lock above makes this unreachable; kept so a future caller that
    -- skips it still cannot lose a document.
    return jsonb_build_object('err', jsonb_build_object('staleRevision', jsonb_build_object(
      'expected', p_expected_revision, 'actual', v_existing.revision)));
  end if;

  insert into activity (owner_id, kind, title)
       values (v_owner, 'note', format('Updated the note "%s"', p_title));

  return jsonb_build_object('ok', to_jsonb(v_row));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. resolve_link: a browser locale must not be able to break a redirect.
-- ---------------------------------------------------------------------------
--
-- link_scan.country carries `check (country ~ '^[A-Za-z]{2}$')` and the insert
-- passed the caller's text through unchanged. The app's own hint comes from
-- navigator.language.split('-')[1], which is "419" for es-419 (Chrome's locale
-- for Latin American Spanish) and "Hans" for zh-Hans-* — three and four
-- characters. The CHECK then raised 23514 inside resolve_link, which has no
-- handler, so PostgREST returned an error, `unwrap` threw, and ScanRedirect
-- showed "This link doesn't exist" for a link that exists and is live. `device`
-- already clamps to the four known values; `country` was the one that trusted
-- its input.
--
-- The throttle branch is handled at the same time: enforce_rate_limit raises
-- P0001, which reached the visitor as the same untrue message. The page has
-- had a "Too many requests / try again" copy for it all along, with nothing
-- ever able to select it.

create or replace function resolve_link(p_code text, p_device text default 'other', p_country text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public, pg_temp
as $$
declare
  v_link link;
begin
  if exists (
       select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'enforce_rate_limit'
     ) then
    begin
      perform enforce_rate_limit('resolve_link', 60, 60);
    exception when raise_exception then
      return jsonb_build_object('unavailable', 'rateLimited');
    end;
  end if;

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
               -- Same shape as the column CHECK, applied before the insert: a
               -- hint that cannot be stored is dropped, not fatal. Spelled
               -- without a counted class so the short-code drift guard, which
               -- reads the newest migration's `{n,m}` patterns as the code
               -- rule, cannot mistake a country for a code.
               case when p_country ~ '^[A-Za-z]+$'
                     and char_length(p_country) = 2 then upper(p_country) end);
  return jsonb_build_object('targetUrl', v_link.target_url);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. create_link: say "rate limited" instead of throwing.
-- ---------------------------------------------------------------------------
--
-- The adapter retries a taken code three times and maps any other `err` to a
-- rateLimited result with a "try again" toast; neither is reachable while the
-- throttle raises out of the function.

create or replace function create_link(p_target_url text, p_code text, p_edit_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path = public, 'extensions', pg_temp
as $$
declare
  v_url text := btrim(coalesce(p_target_url, ''));
  v_problem text;
  v_row link;
begin
  if exists (
       select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'enforce_rate_limit'
     ) then
    begin
      perform enforce_rate_limit('create_link', 20, 60);
    exception when raise_exception then
      return jsonb_build_object('err', 'rateLimited');
    end;
  end if;

  v_problem := url_target_problem(v_url);
  if v_problem is not null then
    return jsonb_build_object('err', jsonb_build_object('invalidUrl', v_problem));
  end if;
  -- The range 0003 widened `link.code`'s own CHECK to. The column is the
  -- authority: if 0003 has not been applied the insert below fails its CHECK
  -- and check_violation answers badCode, so this definition is correct in
  -- either world and cannot accept a code the row would refuse.
  if p_code is null or p_code !~ '^[2-9a-hjkmnp-z]{7,12}$' then
    return jsonb_build_object('err', 'badCode');
  end if;
  if p_edit_token is null or char_length(p_edit_token) < 24 then
    return jsonb_build_object('err', 'badToken');
  end if;

  insert into link (owner_id, code, edit_token_hash, target_url)
       values (auth.uid(), p_code, encode(digest(p_edit_token, 'sha256'), 'hex'), v_url)
  returning * into v_row;

  return jsonb_build_object('ok', jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'code', v_row.code,
    'targetUrl', v_row.target_url,
    'shortUrl', '/r/' || v_row.code,
    'manageUrl', '/manage/' || p_edit_token,
    'editToken', p_edit_token,
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at));
exception
  when unique_violation then
    return jsonb_build_object('err', 'codeTaken');
  when check_violation then
    -- Reachable only when the live `link.code` CHECK is narrower than the
    -- validator above, i.e. before 0003 is applied.
    return jsonb_build_object('err', 'badCode');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. answer_is_correct: never cast text a caller stored.
-- ---------------------------------------------------------------------------
--
-- `(… ->> 'value')::boolean` runs on whatever the row holds, and the question
-- CHECK only requires the key to exist: `"correct": "yes"` is storable,
-- because both the archive importer and the AI draft writer persist the answer
-- object they were given. The first submit of that question then raised 22P02
-- out of submit_answer, which the adapter only knows how to switch on `{err}`
-- replies for — so the practice session dies on a row the same database
-- accepted. Compare the two normalised strings instead; nothing is cast.

create or replace function answer_is_correct(submitted jsonb, expected jsonb) returns boolean
language sql
immutable
as $$
  select case
    when submitted is null or expected is null then false
    when submitted ->> '__kind__' is distinct from expected ->> '__kind__' then false
    when submitted ->> '__kind__' = 'trueFalse' then
      -- Anything that is not literally true reads as false, on both sides, so
      -- a malformed expected answer makes the question wrong rather than
      -- raising on every attempt of it.
      (lower(btrim(coalesce(submitted -> 'trueFalse' ->> 'value', ''))) = 'true')
      =
      (lower(btrim(coalesce(expected -> 'trueFalse' ->> 'correct', ''))) = 'true')
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

-- ---------------------------------------------------------------------------
-- 7. start_session: reject what the column would reject.
-- ---------------------------------------------------------------------------
--
-- It tested `> 0` while session.duration_seconds is checked `between 1 and
-- 86400`, so a duration over 24 hours raised 23514 through the adapter's
-- `{err}`-only error handling.

create or replace function start_session(
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
    if p_duration_seconds is null or p_duration_seconds not between 1 and 86400 then
      return jsonb_build_object('err', jsonb_build_object('invalidInput', 'durationSeconds must be between 1 and 86400'));
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
  -- `row_number() over ()` with no ORDER BY numbers the rows before the
  -- `order by q.id` below is applied, so `position` could come out a
  -- permutation of the order the questions were taken in. Numbering the same
  -- ordering the insert uses is what keeps getSession's "creation order"
  -- contract true.
  insert into session_item (owner_id, session_id, position, question_id, topic_id, prompt,
                            question_type, options, answer, explanation)
  select v_owner, v_session_id, row_number() over (order by q.id) - 1, q.id, q.topic_id, q.prompt,
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

  -- The id, not a view: `getSession(id)` in the adapter is then the single
  -- place a SessionView is assembled, so startSession and getSession cannot
  -- drift apart the way two hand-written projections would.
  return jsonb_build_object('ok', v_session_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Keep enforce_rate_limit private.
-- ---------------------------------------------------------------------------
--
-- 0002 revokes it from authenticated on line 55 and then, at the bottom of the
-- same file, runs `grant execute on all functions in schema public to
-- authenticated`, which hands it straight back. Any signed-in user can then
-- RPC enforce_rate_limit('create_link', 1, 60) and spend somebody else's
-- budget for that minute, since a bucket is keyed on the shared IP.

do $$
begin
  if exists (
       select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'enforce_rate_limit'
     ) then
    revoke all on function public.enforce_rate_limit(text, integer, integer)
      from public, anon, authenticated;
    -- Only the definers in this schema call it, and they call it as the
    -- function owner, so no grant is needed for them to keep working.
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Index the joins the pages actually run.
-- ---------------------------------------------------------------------------
--
-- subject.class_id, chapter.subject_id and topic.chapter_id had no index, so
-- every list page ran a seq scan per level, and each *_rows() function runs a
-- correlated child count on top of that (listClasses() was O(classes x
-- subjects) scans). content_share had no owner timeline for listShares.
-- link_scan's cascade key is already indexed via link_scan_link_idx.

create index if not exists subject_class_idx   on subject (class_id);
create index if not exists chapter_subject_idx on chapter (subject_id);
create index if not exists topic_chapter_idx   on topic (chapter_id);
create index if not exists content_share_owner_idx on content_share (owner_id, created_at desc);
-- question_topic_idx leads with owner_id, so it cannot serve the topic_id
-- lookup that deleting a topic needs before its cascade runs.
create index if not exists question_topic_fk_idx on question (topic_id);

-- ---------------------------------------------------------------------------
-- 10. The two 0002 tables, without 0002 having to be applied first.
-- ---------------------------------------------------------------------------
--
-- rate_limit's primary key leads with `bucket`, so
-- `delete from rate_limit where window_start < v_window` — which
-- enforce_rate_limit runs on every guarded request — scans the whole table and
-- takes share locks on the hottest rows in the schema while concurrent
-- visitors are inserting into them.
--
-- custom_session records a finished test-builder run, and the copy it stores
-- is written by the browser: `score >= 0` and `total > 0` were checked, but
-- `score <= total` was not, so the row that merged analytics trusts most is
-- the one the database lets lie. `result` has had that bound since 0001.
-- Both blocks are conditional on the table being there, so this file is safe
-- before 0002 as well as after it.

do $$
begin
  if to_regclass('public.rate_limit') is not null then
    execute 'create index if not exists rate_limit_window_idx on rate_limit (window_start)';
  end if;
end;
$$;

do $$
declare
  v_bad integer;
begin
  if to_regclass('public.custom_session') is null then
    return;
  end if;

  select count(*) into v_bad from custom_session where score > total;
  if v_bad > 0 then
    raise exception
      '0004 stopped: % custom_session rows have score above total (id: '
      'select id, score, total from custom_session where score > total). '
      'Correct or delete them, then re-run — the constraint is the point.', v_bad;
  end if;
  select count(*) into v_bad from custom_session where completed_at < started_at;
  if v_bad > 0 then
    raise exception
      '0004 stopped: % custom_session rows finish before they start, which means '
      'the device clock was wrong when they were saved (id: select id, started_at, '
      'completed_at from custom_session where completed_at < started_at). Those '
      'rows move the day streak to a date that has not happened yet.', v_bad;
  end if;

  execute 'alter table custom_session add constraint custom_session_score_within_total check (score <= total)';
  execute 'alter table custom_session add constraint custom_session_finishes_after_start check (completed_at >= started_at)';
  -- The dashboard reads exactly this: the owner's finished runs, newest first.
  execute 'create index if not exists custom_session_owner_idx on custom_session (owner_id, completed_at desc)';
exception
  when duplicate_table or duplicate_object then
    -- Already applied; a re-run is not an error.
    null;
end;
$$;
