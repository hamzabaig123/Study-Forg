-- StudyForge test-history behaviour test (migration 0016).
--
-- What it proves: a recorded run and a Test Builder run both appear in one
-- newest-first list with the right counts; each can be opened with every
-- question in order; a run on content deleted since stays reviewable and is
-- flagged; a second account can neither list, open nor delete the first
-- account's tests; an unconfirmed account sees nothing; `anon` cannot call the
-- history at all; and a delete removes the attempt with its questions.
--
-- How to run: paste the WHOLE file into the SQL editor (or send it through the
-- Management API query endpoint) as one script. It runs in one transaction that
-- ends in ROLLBACK, so nothing survives. The last line is `NOTICE: PASS ...`;
-- any failure raises an exception naming the check.

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('11111111-1111-4111-8111-111111111111', 'history-a@studyforge.test', 'x', now(), 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'history-b@studyforge.test', 'x', now(), 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'history-c@studyforge.test', 'x', null,  'authenticated', 'authenticated');

create temp table fixture (topic_id bigint, q1 bigint, q2 bigint, session_id bigint);
grant select, insert, update on table fixture to public;
insert into fixture default values;

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';

-- A builds a topic with two true/false questions and runs a practice session:
-- one answered correctly, one left unanswered.
do $$
declare
  v_class bigint; v_subject bigint; v_chapter bigint; v_topic bigint;
  v_q1 bigint; v_q2 bigint; v_session bigint; r jsonb;
begin
  insert into class (name) values ('History class') returning id into v_class;
  insert into subject (class_id, name) values (v_class, 'Chemistry') returning id into v_subject;
  insert into chapter (subject_id, name) values (v_subject, 'Bonding') returning id into v_chapter;
  insert into topic (chapter_id, name) values (v_chapter, 'Ionic bonds') returning id into v_topic;
  insert into question (topic_id, prompt, question_type, answer)
    values (v_topic, 'NaCl is ionic.', 'trueFalse', '{"__kind__":"trueFalse","trueFalse":{"correct":true}}')
    returning id into v_q1;
  insert into question (topic_id, prompt, question_type, answer)
    values (v_topic, 'Ionic bonds share electrons.', 'trueFalse', '{"__kind__":"trueFalse","trueFalse":{"correct":false}}')
    returning id into v_q2;

  r := start_session('practice', 'topic', v_topic, null, null);
  if not (r ? 'ok') then
    raise exception 'FAIL(setup): start_session refused: %', r;
  end if;
  v_session := (r ->> 'ok')::bigint;
  r := submit_answer(v_session, v_q1, '{"__kind__":"trueFalse","trueFalse":{"value":true}}');
  if not (r ? 'ok') then
    raise exception 'FAIL(setup): submit_answer refused: %', r;
  end if;
  r := complete_session(v_session);
  if not (r ? 'ok') then
    raise exception 'FAIL(setup): complete_session refused: %', r;
  end if;

  update fixture set topic_id = v_topic, q1 = v_q1, q2 = v_q2, session_id = v_session;

  -- A Test Builder run mirrored from another device, finished after the session:
  -- one wrong answer, one unanswered, two subjects.
  insert into custom_session (id, mode, scope_label, duration_seconds, started_at, completed_at, score, total, results)
  values (
    'thistory01', 'timedTest', 'Mixed revision', 600,
    now() + interval '1 minute', now() + interval '5 minutes', 0, 2,
    '[{"questionId":"901","prompt":"Speed of light?","questionType":"multipleChoice",
       "submitted":{"__kind__":"multipleChoice","multipleChoice":{"optionId":"2"}},
       "correct":false,
       "correctAnswer":{"__kind__":"multipleChoice","multipleChoice":{"options":[{"id":"1","text":"3e8 m/s"},{"id":"2","text":"3e6 m/s"}],"correctOptionId":"1"}},
       "explanation":"About 300 000 km/s.",
       "labels":{"className":"Class 11","subjectName":"Physics","chapterName":"Waves","topicName":"Light"}},
      {"questionId":"902","prompt":"Water boils at 100 C at sea level.","questionType":"trueFalse",
       "submitted":null,"correct":false,
       "correctAnswer":{"__kind__":"trueFalse","trueFalse":{"correct":true}},
       "explanation":null,
       "labels":{"className":"Class 11","subjectName":"Chemistry","chapterName":"Matter","topicName":"States"}}]'::jsonb
  );
end
$$;

-- The list: both attempts, newest first, with the counts the page shows.
do $$
declare h jsonb; s jsonb; c jsonb;
begin
  h := test_history();
  if jsonb_array_length(h) <> 2 then
    raise exception 'FAIL(list): A sees % attempts, expected 2: %', jsonb_array_length(h), h;
  end if;
  c := h -> 0;
  s := h -> 1;
  if c ->> 'kind' <> 'custom' or s ->> 'kind' <> 'session' then
    raise exception 'FAIL(list-order): expected the later custom run first, got % then %', c ->> 'kind', s ->> 'kind';
  end if;
  if s ->> 'id' <> (select session_id::text from fixture)
     or (s ->> 'score')::int <> 1 or (s ->> 'total')::int <> 2 or (s ->> 'answered')::int <> 1
     or s ->> 'title' <> 'Ionic bonds' or (s ->> 'contentRemoved')::boolean
     or s -> 'subjects' <> '["Chemistry"]'::jsonb or s -> 'classes' <> '["History class"]'::jsonb
     or s ->> 'mode' <> 'practice' or s ->> 'scopeKind' <> 'topic' then
    raise exception 'FAIL(list-session): the recorded run reads %', s;
  end if;
  if (c ->> 'score')::int <> 0 or (c ->> 'total')::int <> 2 or (c ->> 'answered')::int <> 1
     or (c ->> 'timeLimitSeconds')::int <> 600
     or c -> 'subjects' <> '["Chemistry", "Physics"]'::jsonb
     or c -> 'classes' <> '["Class 11"]'::jsonb
     or c ->> 'scopeKind' <> 'custom' then
    raise exception 'FAIL(list-custom): the Test Builder run reads %', c;
  end if;
end
$$;

-- The detail: every question, in order, with what was given and what was right.
do $$
declare d jsonb; n int;
begin
  d := test_history_detail('session', (select session_id::text from fixture));
  if d is null or jsonb_array_length(d -> 'items') <> 2 then
    raise exception 'FAIL(detail-session): %', d;
  end if;
  select count(*) into n from jsonb_array_elements(d -> 'items') i where (i ->> 'correct')::boolean;
  if n <> 1 then
    raise exception 'FAIL(detail-session): % correct items, expected 1', n;
  end if;
  select count(*) into n from jsonb_array_elements(d -> 'items') i where jsonb_typeof(i -> 'submitted') = 'object';
  if n <> 1 then
    raise exception 'FAIL(detail-session): % answered items, expected 1', n;
  end if;
  if (d -> 'items' -> 0 ->> 'position')::int <> 0 or (d -> 'items' -> 1 ->> 'position')::int <> 1 then
    raise exception 'FAIL(detail-order): positions read % and %', d -> 'items' -> 0 ->> 'position', d -> 'items' -> 1 ->> 'position';
  end if;

  d := test_history_detail('custom', 'thistory01');
  if d is null or jsonb_array_length(d -> 'items') <> 2
     or d -> 'items' -> 0 ->> 'prompt' <> 'Speed of light?'
     or d -> 'items' -> 0 -> 'submitted' -> 'multipleChoice' ->> 'optionId' <> '2'
     or d -> 'items' -> 0 -> 'labels' ->> 'subjectName' <> 'Physics'
     or jsonb_typeof(d -> 'items' -> 1 -> 'submitted') <> 'null'
     or d ->> 'title' <> 'Mixed revision' then
    raise exception 'FAIL(detail-custom): %', d;
  end if;

  if test_history_detail('session', 'not-a-number') is not null
     or test_history_detail('elsewhere', '1') is not null
     or test_history_detail('custom', 'nosuchrun') is not null
     or test_history_detail(null, null) is not null then
    raise exception 'FAIL(detail-malformed): a malformed or unknown address returned a body';
  end if;
end
$$;

-- B: nothing of A's to list, open or delete.
set local request.jwt.claims = '{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}';

do $$
begin
  if test_history() <> '[]'::jsonb then
    raise exception 'FAIL(cross-list): B lists %', test_history();
  end if;
  if test_history_detail('session', (select session_id::text from fixture)) is not null
     or test_history_detail('custom', 'thistory01') is not null then
    raise exception 'FAIL(cross-detail): B opened one of A''s tests';
  end if;
  if delete_test_attempt('session', (select session_id::text from fixture))
     or delete_test_attempt('custom', 'thistory01') then
    raise exception 'FAIL(cross-delete): B deleted one of A''s tests';
  end if;
end
$$;

-- C never confirmed the address: the owner policies hide even its own rows.
set local request.jwt.claims = '{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333"}';

do $$
begin
  if test_history() <> '[]'::jsonb then
    raise exception 'FAIL(unconfirmed): an unconfirmed account lists %', test_history();
  end if;
end
$$;

-- anon has no execute grant on the history.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  perform test_history();
  raise exception 'FAIL(anon): anon executed test_history()';
exception
  when insufficient_privilege then null;
end
$$;

do $$
begin
  perform delete_test_attempt('custom', 'thistory01');
  raise exception 'FAIL(anon): anon executed delete_test_attempt()';
exception
  when insufficient_privilege then null;
end
$$;

-- Back to A: deleting the topic keeps the attempt, flagged and still reviewable.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';

do $$
declare s jsonb; d jsonb;
begin
  -- B's refused delete above must have left both attempts in place.
  if jsonb_array_length(test_history()) <> 2 then
    raise exception 'FAIL(cross-delete): A now has % attempts, expected 2', jsonb_array_length(test_history());
  end if;

  delete from topic where id = (select topic_id from fixture);
  select h into s from jsonb_array_elements(test_history()) h where h ->> 'kind' = 'session';
  if s is null or not (s ->> 'contentRemoved')::boolean or s ->> 'title' <> 'Ionic bonds'
     or s -> 'subjects' <> '[]'::jsonb then
    raise exception 'FAIL(removed-content): after the topic was deleted the run reads %', s;
  end if;
  d := test_history_detail('session', (select session_id::text from fixture));
  if d is null or jsonb_array_length(d -> 'items') <> 2 then
    raise exception 'FAIL(removed-content): the run can no longer be reviewed: %', d;
  end if;
end
$$;

-- A deletes both attempts; the questions go with the recorded run.
do $$
declare n int;
begin
  if not delete_test_attempt('session', (select session_id::text from fixture)) then
    raise exception 'FAIL(delete): A could not delete its own recorded run';
  end if;
  if delete_test_attempt('session', (select session_id::text from fixture)) then
    raise exception 'FAIL(delete): a second delete of the same run reported success';
  end if;
  select count(*) into n from result_item;
  if n <> 0 then
    raise exception 'FAIL(delete-cascade): % result items outlived their run', n;
  end if;
  if not delete_test_attempt('custom', 'thistory01') then
    raise exception 'FAIL(delete): A could not delete its own Test Builder run';
  end if;
  if test_history() <> '[]'::jsonb then
    raise exception 'FAIL(delete): the history still lists %', test_history();
  end if;
  if delete_test_attempt('session', 'abc') or delete_test_attempt('bogus', '1') then
    raise exception 'FAIL(delete-malformed): a malformed address reported a delete';
  end if;
end
$$;

do $$
begin
  raise notice 'PASS: all test-history checks succeeded (nothing is committed — the script rolls back)';
end
$$;

rollback;
