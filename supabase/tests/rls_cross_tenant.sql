-- StudyForge cross-tenant RLS test.
--
-- What it proves, in one paste: one signed-in account cannot see or change
-- another account's rows; an unconfirmed account cannot write at all; `anon`
-- cannot read tables but the token-addressed link surface still works; and
-- `abuse_report` stays closed to direct writes even for `authenticated`, while
-- the abuse RPC gives no caller a way to ask whether a short code exists.
--
-- How to run: paste the WHOLE file into the Supabase dashboard SQL editor and
-- execute it as one script. Everything happens inside one transaction that
-- ends in ROLLBACK, so no fixture user, class or link survives the run. The
-- final line is `NOTICE: PASS ...`; any failure raises an exception naming
-- the check and aborts the transaction.
--
-- This complements, not replaces, supabase/verify.sql: that file inspects
-- configuration (policies, grants); this file exercises behaviour as three
-- different identities.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: two confirmed accounts (A and B) and one unconfirmed (C).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('11111111-1111-4111-8111-111111111111', 'rls-a@studyforge.test', 'x', now(), 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'rls-b@studyforge.test', 'x', now(), 'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'rls-c@studyforge.test', 'x', null,  'authenticated', 'authenticated');

create temp table owned (a_class bigint, a_subject bigint, a_chapter bigint, a_topic bigint, a_question bigint);

-- The fixture ids are written and read after `set local role authenticated`,
-- and a temp table belongs to whoever created it, so hand the session roles
-- the rights on it. (A fresh superuser-owned object named `owned` exists only
-- in this transaction.)
grant select, insert, update on table owned to public;

-- ---------------------------------------------------------------------------
-- Account A builds a full hierarchy.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';

with new as (insert into class (name) values ('A class') returning id)
insert into owned (a_class) select id from new;

with new as (insert into subject (class_id, name) select a_class, 'A subject' from owned returning id)
update owned set a_subject = new.id from new;

with new as (insert into chapter (subject_id, name) select a_subject, 'A chapter' from owned returning id)
update owned set a_chapter = new.id from new;

with new as (insert into topic (chapter_id, name) select a_chapter, 'A topic' from owned returning id)
update owned set a_topic = new.id from new;

with new as (
  insert into question (topic_id, prompt, question_type, answer)
  select a_topic, 'Is A true?', 'trueFalse',
         '{"__kind__":"trueFalse","trueFalse":{"correct":true}}'::jsonb
  from owned returning id
)
update owned set a_question = new.id from new;

do $$
declare n int;
begin
  select count(*) into n from class;
  if n <> 1 then
    raise exception 'FAIL(owner-read): A sees % of its own classes, expected 1', n;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Account B sees nothing of A's and cannot write into A's rows.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}';

do $$
declare n int;
begin
  select count(*) into n from class;
  if n <> 0 then
    raise exception 'FAIL(cross-read): B sees % classes it does not own', n;
  end if;
  select count(*) into n from topic;
  if n <> 0 then
    raise exception 'FAIL(cross-read): B sees % topics it does not own', n;
  end if;
end
$$;

do $$
declare n int;
begin
  update class set name = 'stolen' where id = (select a_class from owned);
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL(cross-update): B changed a class it does not own';
  end if;
  delete from question where id = (select a_question from owned);
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL(cross-delete): B deleted a question it does not own';
  end if;
end
$$;

do $$
begin
  insert into subject (class_id, name)
  select a_class, 'planted' from owned;
  raise exception 'FAIL(cross-insert): B added a subject under A''s class';
exception
  when insufficient_privilege then null; -- the with-check policy refused it: pass
end
$$;

-- B's own write succeeds, so the refusals above are about ownership, not
-- about the role or the claims mechanism.
do $$
declare n int;
begin
  insert into class (name) values ('B class');
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL(owner-write): B could not create its own class';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Account C exists but never confirmed the address: no writes at all.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333"}';

do $$
begin
  insert into class (name) values ('unconfirmed');
  raise exception 'FAIL(unconfirmed-write): an account with no email_confirmed_at inserted a class';
exception
  when insufficient_privilege then null; -- owner_is_verified() refused it: pass
end
$$;

-- ---------------------------------------------------------------------------
-- abuse_report is deny-by-default for direct writes, and the abuse RPC answers
-- a code the service never issued with the same body it uses for a real one.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}';

do $$
begin
  insert into abuse_report (code, reason) values ('abcd234', 'direct write must not be possible');
  raise exception 'FAIL(abuse-deny): authenticated wrote abuse_report directly';
exception
  when insufficient_privilege then null; -- implicit deny: pass
end
$$;

-- The reply alone has to be unreadable as an existence test; the matching
-- "a real code writes a row, this one did not" check is at the end of the file,
-- where a real code exists.
do $$
declare r jsonb;
begin
  r := report_link_abuse('nosuch99', 'unknown code');
  if r is distinct from '{"ok": null}'::jsonb then
    raise exception 'FAIL(abuse-oracle): report_link_abuse answered a never-issued code with % — it must answer the same {"ok":null} a real code gets, or the public report endpoint tells a caller which short codes exist', r;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Links: A creates one through the RPC, only A sees the row, and `anon`
-- resolves it by code without any table access.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';

do $$
declare r jsonb;
begin
  r := create_link('https://example.com/a', 'abcd234', 'rls-test-edit-token-0000000001');
  if not (r ? 'ok') then
    raise exception 'FAIL(link-create): create_link refused a valid request: %', r;
  end if;
end
$$;

do $$
declare n int;
begin
  select count(*) into n from link;
  if n <> 1 then
    raise exception 'FAIL(link-owner): A sees % of its own links, expected 1', n;
  end if;
end
$$;

set local request.jwt.claims = '{"role":"authenticated","sub":"22222222-2222-4222-8222-222222222222"}';

do $$
declare n int;
begin
  select count(*) into n from link;
  if n <> 0 then
    raise exception 'FAIL(link-cross): B sees % links it does not own', n;
  end if;
end
$$;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare n int;
begin
  select count(*) into n from class;
  raise exception 'FAIL(anon-table): anon read the class table (% rows)', n;
exception
  when insufficient_privilege then null; -- the revoke from anon: pass
end
$$;

do $$
declare r jsonb;
begin
  r := resolve_link('abcd234', 'mobile');
  if r ->> 'targetUrl' <> 'https://example.com/a' then
    raise exception 'FAIL(anon-resolve): resolve_link answered %', r;
  end if;
end
$$;

do $$
declare n int;
begin
  select count(*) into n from link_scan;
  raise exception 'FAIL(anon-table): anon read link_scan';
exception
  when insufficient_privilege then null;
end
$$;

-- The scan the resolution just recorded belongs to A, not to nobody.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';

do $$
declare n int;
begin
  select count(*) into n from link_scan;
  if n <> 1 then
    raise exception 'FAIL(scan-owner): A sees % link scans for its link, expected 1', n;
  end if;
end
$$;

-- The other half of the abuse oracle, now that a real code exists: the report
-- for it and the report for a never-issued code answer identically, and only the
-- real one leaves a row. Read as the owner on purpose — `abuse_report` grants a
-- client role no SELECT policy, so a count taken under `authenticated` reads 0
-- rows either way and proves nothing.
reset role;

do $$
declare
  v_real   jsonb;
  v_ghost  jsonb;
  v_seen   int;
  v_unseen int;
begin
  v_real  := report_link_abuse('abcd234', 'a report against a live code');
  v_ghost := report_link_abuse('nosuch99', 'a report against a live code');
  if v_real is distinct from v_ghost then
    raise exception 'FAIL(abuse-oracle): the two replies differ — % for a code that exists, % for one that does not', v_real, v_ghost;
  end if;
  select count(*) into v_seen from abuse_report where code = 'abcd234';
  if v_seen <> 1 then
    raise exception 'FAIL(abuse-record): a real code''s report wrote % rows, expected 1', v_seen;
  end if;
  select count(*) into v_unseen from abuse_report where code = 'nosuch99';
  if v_unseen <> 0 then
    raise exception 'FAIL(abuse-record): % rows filed for a code that exists nowhere', v_unseen;
  end if;
end
$$;

do $$
begin
  raise notice 'PASS: all cross-tenant RLS checks succeeded (nothing is committed — the script rolls back)';
end
$$;

rollback;
