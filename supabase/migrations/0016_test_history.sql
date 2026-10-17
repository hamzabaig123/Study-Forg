-- 0016 — one history of every test, and a way back into each of them
--
-- A finished test is recorded in one of two places. A topic or chapter run
-- graded by Postgres lands in `result` + `result_item` (0001); a Test Builder
-- run graded in the browser is mirrored into `custom_session` with its
-- per-question rows as jsonb (0002). Both keep a full snapshot of every
-- question — prompt, the answer given, the right answer, the explanation — so
-- the data for "show me what I got wrong three weeks ago" was always stored.
-- What was missing is a read over it:
--
--   1. **No single list.** The client stitched `attempt_history()` and a
--      `custom_session` select together and only ever showed a score per row.
--   2. **A test on deleted content disappeared.** `attempt_history()` and the
--      adapter's result read both drop a row whose topic or chapter no longer
--      exists. That is right for the accuracy charts (a bucket needs a live
--      label) and wrong for a history: the attempt happened, and `result_item`
--      still holds every question it asked. Here such a row stays, titled by the
--      label captured when it ran and flagged `contentRemoved`.
--   3. **A Test Builder run could only be reviewed on the device that ran it.**
--      The mirror stored the questions, but nothing read them back.
--
-- So this file adds four functions and no tables:
--
--   test_attempts()                every attempt as (kind, id, completed_at, json)
--   test_history()                 every attempt, newest first, with its counts
--   test_history_detail(kind, id)  one attempt plus its questions in order
--   delete_test_attempt(kind, id)  remove one attempt (its items cascade)
--
-- An attempt is addressed by `(kind, id)`: kind `session` takes the session id
-- (unique since 0004's `result_session_uidx`, and the id `/results/:id` already
-- uses), kind `custom` takes the run's own text id.
--
-- All four are SECURITY INVOKER, so the owner policies on `result`,
-- `result_item` and `custom_session` — `owner_id = auth.uid() and
-- owner_is_verified()` — decide what a caller can see or delete; the explicit
-- `owner_id = auth.uid()` in each body is there for the planner, which then
-- walks `result_recent_idx` and `custom_session_owner_idx` rather than the
-- table. No index is added: those two, `result_session_uidx` and
-- `result_item`'s unique `(result_id, position)` already cover every lookup.
--
-- Apply after 0004 (the unique session index) and 0002 (`custom_session`).

-- Every attempt as one row: the key the readers filter and sort on, plus the
-- wire shape built once, so the list and a detail header cannot disagree about
-- what an attempt is.
create or replace function test_attempts()
returns table (kind text, id text, completed_at timestamptz, attempt jsonb)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.kind, a.id, a.completed_at,
         jsonb_build_object(
           'kind', a.kind,
           'id', a.id,
           'mode', a.mode,
           'scopeKind', a.scope_kind,
           'title', a.title,
           'startedAt', a.started_at,
           'completedAt', a.completed_at,
           'timeLimitSeconds', a.time_limit_seconds,
           'score', a.score,
           'total', a.total,
           'answered', a.answered,
           'contentRemoved', a.content_removed,
           'subjects', to_jsonb(a.subjects),
           'classes', to_jsonb(a.classes)
         )
    from (
      select
        'session'::text                     as kind,
        r.session_id::text                  as id,
        r.mode                              as mode,
        r.scope_kind                        as scope_kind,
        coalesce(live.name, r.scope_label)  as title,
        r.started_at                        as started_at,
        r.completed_at                      as completed_at,
        null::integer                       as time_limit_seconds,
        r.score                             as score,
        r.total                             as total,
        (select count(*)::integer from result_item ri
          where ri.result_id = r.id and ri.submitted is not null) as answered,
        live.name is null                   as content_removed,
        case when s.name is null then '{}'::text[] else array[s.name] end   as subjects,
        case when cl.name is null then '{}'::text[] else array[cl.name] end as classes
      from result r
      -- The scope's current name and the subject it sits under. A topic or
      -- chapter deleted since the run leaves `live` empty, which is the
      -- `content_removed` signal rather than a reason to drop the row.
      left join lateral (
        select t.name, c.subject_id
          from topic t
          join chapter c on c.id = t.chapter_id
         where r.scope_kind = 'topic' and t.id = r.scope_id and t.owner_id = r.owner_id
        union all
        select c.name, c.subject_id
          from chapter c
         where r.scope_kind = 'chapter' and c.id = r.scope_id and c.owner_id = r.owner_id
        limit 1
      ) live on true
      left join subject s on s.id = live.subject_id
      left join class cl on cl.id = s.class_id
      where r.owner_id = auth.uid()

      union all

      select
        'custom'::text,
        c.id,
        c.mode,
        'custom'::text,
        c.scope_label,
        c.started_at,
        c.completed_at,
        c.duration_seconds,
        c.score,
        c.total,
        -- An unanswered question is stored as `submitted: null`, a json null
        -- rather than a missing key, so "answered" is "submitted is an object".
        (select count(*)::integer from jsonb_array_elements(c.results) item
          where jsonb_typeof(item -> 'submitted') = 'object'),
        false,
        -- A built test can span subjects; the labels were captured per question
        -- when it was assembled, so they survive the content being renamed.
        coalesce((select array_agg(distinct named.label order by named.label)
                    from (select nullif(btrim(item -> 'labels' ->> 'subjectName'), '') as label
                            from jsonb_array_elements(c.results) item) named
                   where named.label is not null), '{}'::text[]),
        coalesce((select array_agg(distinct named.label order by named.label)
                    from (select nullif(btrim(item -> 'labels' ->> 'className'), '') as label
                            from jsonb_array_elements(c.results) item) named
                   where named.label is not null), '{}'::text[])
      from custom_session c
      where c.owner_id = auth.uid()
    ) a;
$$;

create or replace function test_history() returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
           jsonb_agg(a.attempt order by a.completed_at desc, a.kind, a.id desc),
           '[]'::jsonb)
    from test_attempts() a;
$$;

create or replace function test_history_detail(p_kind text, p_id text) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_attempt jsonb;
  v_items   jsonb;
begin
  -- A malformed address is "not found", not an error: the id comes from a URL.
  if p_kind is null or p_id is null
     or p_kind not in ('session', 'custom')
     or char_length(p_id) > 64
     or (p_kind = 'session' and p_id !~ '^[0-9]{1,18}$') then
    return null;
  end if;

  select a.attempt into v_attempt
    from test_attempts() a
   where a.kind = p_kind and a.id = p_id;
  if v_attempt is null then
    return null;
  end if;

  if p_kind = 'session' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', ri.position,
             'questionId', ri.question_id::text,
             'prompt', ri.prompt,
             'questionType', ri.question_type,
             'submitted', ri.submitted,
             'correct', ri.correct,
             'correctAnswer', ri.correct_answer,
             'explanation', ri.explanation,
             'labels', null
           ) order by ri.position), '[]'::jsonb)
      into v_items
      from result r
      join result_item ri on ri.result_id = r.id
     where r.owner_id = auth.uid() and r.session_id = p_id::bigint;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', item.ordinality - 1,
             'questionId', item.value ->> 'questionId',
             'prompt', item.value ->> 'prompt',
             'questionType', item.value ->> 'questionType',
             'submitted', case when jsonb_typeof(item.value -> 'submitted') = 'object'
                               then item.value -> 'submitted' end,
             'correct', coalesce((item.value ->> 'correct')::boolean, false),
             'correctAnswer', item.value -> 'correctAnswer',
             'explanation', item.value ->> 'explanation',
             'labels', item.value -> 'labels'
           ) order by item.ordinality), '[]'::jsonb)
      into v_items
      from custom_session c
      cross join lateral jsonb_array_elements(c.results) with ordinality as item(value, ordinality)
     where c.owner_id = auth.uid() and c.id = p_id;
  end if;

  return v_attempt || jsonb_build_object('items', v_items);
end;
$$;

create or replace function delete_test_attempt(p_kind text, p_id text) returns boolean
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  if p_kind = 'session' and p_id ~ '^[0-9]{1,18}$' then
    -- `result_item` follows through its `on delete cascade`.
    delete from result
     where owner_id = auth.uid() and session_id = p_id::bigint;
    get diagnostics v_deleted = row_count;
  elsif p_kind = 'custom' and p_id is not null and char_length(p_id) <= 64 then
    delete from custom_session
     where owner_id = auth.uid() and id = p_id;
    get diagnostics v_deleted = row_count;
  end if;
  return v_deleted > 0;
end;
$$;

-- `create or replace function` keeps whatever grants a re-run finds, and a new
-- function starts executable by PUBLIC (and, on Supabase, by `anon` through the
-- platform's default privileges), so the client roles are set explicitly here,
-- after every create, rather than left to a default or a blanket grant.
revoke all on function test_attempts() from public, anon;
revoke all on function test_history() from public, anon;
revoke all on function test_history_detail(text, text) from public, anon;
revoke all on function delete_test_attempt(text, text) from public, anon;
grant execute on function test_attempts() to authenticated;
grant execute on function test_history() to authenticated;
grant execute on function test_history_detail(text, text) to authenticated;
grant execute on function delete_test_attempt(text, text) to authenticated;

notify pgrst, 'reload schema';
