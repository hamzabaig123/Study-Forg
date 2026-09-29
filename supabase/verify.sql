-- Read-only checks to run in the Supabase SQL editor after 0001_init.sql.
-- Each query is meant to be read, not acted on: the expected result is in its
-- comment. Nothing here writes.
--
-- e2e/apply-migration.mjs asserts numbers 1–7 over the Management API, so this
-- file is what a human runs when the script cannot (or when a printed count needs
-- to be read rather than compared). Number 8 is not a query: it points at
-- tests/rls_cross_tenant.sql, which the script also runs. Numbers 9 and 10 are
-- about migrations 0003 and 0004, so read them as "0 rows / matches" only once
-- those files have been applied — 10 is meant to be run BEFORE 0004 as well.
-- Number 11 is about 0006_reminders.sql. Number 12 is about
-- 0008_helper_function_lockdown.sql, the lockdown of the reminder helpers and
-- the rate limiter that 0006's own blanket grant undid. Number 13 is about
-- 0009_push_subscriptions.sql and number 14 about
-- 0011_trusted_client_address.sql.
--
-- Run every number, not just the ones with a script behind them: item 11 carried
-- a `column reference "attnum" is ambiguous` parse error from the day it was
-- written, which hid two of its six assertions. A check nobody executes is not
-- a check.

-- 1. Every table the app needs exists. Expected: 22 rows once 0001–0009 are all
--    applied — 18 from 0001, minus the ai_draft 0005 drops, plus rate_limit and
--    custom_session from 0002, plus reminder_settings and reminder_log from 0006,
--    plus push_subscriptions from 0009.
--    (17 owner tables + abuse_report + rate_limit + custom_session + the two
--    reminder tables + the one push table.)
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by 1;

-- 2. RLS is on and enforced for the owner. Expected: the same 22 rows, both
--    columns true.
--    FORCE is what protects the owner's own writes: without it a row inserted by
--    the table owner (postgres, the SQL editor) skips every policy.
--    abuse_report carries no policies: with RLS enabled and nothing granted, no
--    role reaches a row directly, and report_link_abuse still writes through its
--    definer function. (A missing row here means abuse_report reads are open to
--    every signed-in user -- see migration step "deny-by-default for the report
--    table".)
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and c.relforcerowsecurity
 order by 1;

-- 3. No table is missing its four owner policies. Expected: 0 rows.
--    (`pg_policies.cmd`, not `permutation` — and INSERT policies carry their
--    check in `with_check`, where `qual` is null.) reminder_settings joins this
--    check from 0006 onward: it carries the same four per-command policies as
--    the owner tables. reminder_log is excluded on purpose — it is read-only for
--    its owner and writable only by the delivery function, so a client can never
--    claim a send it did not make.
with required(role) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
select t.tablename, r.role
  from pg_tables t
 cross join required r
 where t.schemaname = 'public'
   and t.tablename not in ('abuse_report', 'rate_limit', 'reminder_log')
   and not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.tablename
        and p.cmd = r.role
        and (p.qual like '%auth.uid()%' or p.with_check like '%auth.uid()%'))
 order by 1, 2;

-- 4. `anon` can read nothing in the app schema. Expected: 0 rows.
--    (Storage's own tables are granted to anon by the platform; only public
--    is ours to protect.)
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon'
   and table_schema = 'public';

-- 5. `anon` executes only the token-addressed surface. Expected: exactly ten
--    rows -- create_link, resolve_link, shared_content, shared_note,
--    link_detail_for_token, link_scan_stats_for_token, link_set_paused,
--    link_update_target, link_delete, report_link_abuse. Anything else here is
--    an open door.
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'execute')
 order by 1;

-- 6. Every SECURITY DEFINER function pins search_path. Expected: 0 rows.
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and not exists (
     select 1 from unnest(p.proconfig) as cfg(x) where cfg.x like 'search_path=%')
 order by 1;

-- 7. No policy admits `anon`. RLS is off for anon by default (it holds no table
--    privileges at all, checks 4 and 5), so a row here means something granted
--    access twice over. Expected: 0 rows.
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and roles @> array['anon'::name]
 order by 1, 2;

-- 8. Cross-tenant isolation, the test that actually matters. Checks 1-7 prove the
--    doors are configured shut; this proves a row written by account A never
--    reaches account B. It cannot be run here: the SQL editor connects as
--    postgres, where `auth.uid()` is null and every policy is bypassed anyway.
--    Run tests/rls_cross_tenant.sql, which switches between three identities
--    inside one transaction that rolls back, or sign in as two accounts in the
--    app and confirm that `select count(*) from class` for the second never
--    returns the first's rows.

-- 9. The short-code rule the database enforces admits what the client mints.
--    Expected: one row, both columns reading `{10,12}` once 0014 has run
--    (`{7,12}` before it, and `{7}` on a project that never applied 0003). A
--    mismatch means one migration widened the column and not the function (or the
--    reverse), which reaches the UI as create_link answering `badCode` for a
--    perfectly good code. lib/supabase/sqlSurface.contract.test.ts is the offline
--    twin of this check: it compares the same regexes against SHORT_CODE_LENGTH,
--    and insists the *minimum* of the range clears 48 bits — the range is what an
--    anonymous caller gets to choose, `create_link` being granted to `anon`.
select pg_get_constraintdef(con.oid)                                      as column_check,
       (select substring(p.prosrc from '\[2-9a-hjkmnp-z\]\{[0-9,]+\}')
          from pg_proc p
          join pg_namespace fn on fn.oid = p.pronamespace
         where fn.nspname = 'public' and p.proname = 'create_link')        as function_guard
  from pg_constraint con
  join pg_class cls on cls.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = cls.relnamespace
 where nsp.nspname = 'public'
   and cls.relname = 'link'
   and con.contype = 'c'
   and pg_get_constraintdef(con.oid) like '%code ~%';

-- 10. The data invariants 0004_correctness.sql promises, stated over the live
--     rows. Expected: 0 rows, and the `invariant` column names what each count
--     means. These are the shapes the schema before 0004 could reach and the
--     error pages cannot render — two results for one session, an answer that
--     was submitted but never graded, a duration no timer can display, a
--     "country" that is a language tag. Run this BEFORE 0004: a nonzero row
--     makes the migration raise on purpose instead of applying a unique index
--     over data that already breaks it, and this query names those rows.
select 'session with more than one result' as invariant, count(*) as violations
  from (select session_id from result group by session_id having count(*) > 1) d
union all
select 'submitted answer left ungraded', count(*)
  from session_item
 where submitted is not null and correct is null
union all
select 'session duration out of range', count(*)
  from session
 where duration_seconds is not null
   and duration_seconds not between 1 and 86400
union all
select 'link_scan country is not a country', count(*)
  from link_scan
 where country is not null
   and country !~ '^[A-Z][A-Z]$';

-- 11. The reminder invariants 0006 promises, stated over the live schema.
--     Expected: six rows, each reading true. The shape
--     here is a boolean rather than a violation count because the table starts
--     empty — there are no rows to scan, only catalog facts to confirm: the
--     primary key really is the user id, both shape CHECKs are the ones the
--     app writes (HH:MM time, YYYY-MM-DD last-fired day), and RLS is forced.
select invariant, ok
  from (values
    ('primary key is user_id',
      exists (select 1 from pg_constraint
               where conrelid = 'public.reminder_settings'::regclass
                 and contype = 'p'
                 and (select string_agg(a.attname, ', ' order by k.ord)
                        from unnest(conkey) with ordinality as k(attnum, ord)
                        join pg_attribute a on a.attrelid = conrelid and a.attnum = k.attnum)
                     = 'user_id')),
    ('time_of_day check is HH:MM',
      exists (select 1 from pg_constraint
               where conrelid = 'public.reminder_settings'::regclass
                 and contype = 'c'
                 and pg_get_constraintdef(oid)
                     ~ 'time_of_day[ ]*~[ ]*''\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$')),
    ('last_sent_on check is YYYY-MM-DD',
      exists (select 1 from pg_constraint
               where conrelid = 'public.reminder_settings'::regclass
                 and contype = 'c'
                 and pg_get_constraintdef(oid)
                     ~ 'last_sent_on[ ]*~[ ]*''\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$')),
    ('rls enabled and forced',
      exists (select 1 from pg_class
               where oid = 'public.reminder_settings'::regclass
                 and relrowsecurity and relforcerowsecurity)),
    ('reminder_log status check is sent|failed',
      exists (select 1 from pg_constraint
               where conrelid = 'public.reminder_log'::regclass
                 and contype = 'c'
                 and pg_get_constraintdef(oid) like '%status%'
                 and pg_get_constraintdef(oid) like '%sent%'
                 and pg_get_constraintdef(oid) like '%failed%')),
    ('reminder_log grants no client write path',
      not exists (select 1 from pg_policies
                   where schemaname = 'public'
                     and tablename = 'reminder_log'
                     and cmd <> 'SELECT'))
  ) as checks(invariant, ok)
 order by 1;

-- 12. The function-grant invariants 0008 promises, stated over the live schema.
--     The live project granted these three helpers to `authenticated` because
--     the 0006 paste stopped at its blanket `grant execute on all functions in
--     schema public to authenticated` — the revokes that follow it in the
--     committed file never ran. A signed-in user could then execute
--     `due_reminders()` and read every due account's contact details. After
--     0008, no client role may execute any of the three. All three rows must
--     read true; if a helper is missing entirely (dropped, or never applied)
--     the regprocedure cast errors — run 0006/0008 first.
select invariant, ok
  from (values
    ('reminder_digest grants no client role',
      not exists (
        select 1
          from pg_proc p,
               aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                 as a(grantor, grantee, privilege_type)
               join pg_roles g on g.oid = a.grantee
         where p.oid = 'public.reminder_digest(uuid, integer)'::regprocedure
           and a.privilege_type = 'EXECUTE'
           and g.rolname in ('anon', 'authenticated', 'public'))),
    ('due_reminders grants no client role',
      not exists (
        select 1
          from pg_proc p,
               aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                 as a(grantor, grantee, privilege_type)
               join pg_roles g on g.oid = a.grantee
         where p.oid = 'public.due_reminders()'::regprocedure
           and a.privilege_type = 'EXECUTE'
           and g.rolname in ('anon', 'authenticated', 'public'))),
    ('enforce_rate_limit grants no client role',
      not exists (
        select 1
          from pg_proc p,
               aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                 as a(grantor, grantee, privilege_type)
               join pg_roles g on g.oid = a.grantee
         where p.oid = 'public.enforce_rate_limit(text, integer, integer)'::regprocedure
           and a.privilege_type = 'EXECUTE'
           and g.rolname in ('anon', 'authenticated', 'public')))
  ) as checks(invariant, ok)
 order by 1;

-- 13. The web-push invariants 0009 promises, stated over the live schema.
--     A subscription row is account content: RLS forced, no anon grants, and
--     the endpoint (one browser's address) is unique so a re-subscribe
--     upserts rather than piling rows.
select invariant, ok
  from (values
    ('push_subscriptions rls enabled and forced',
      exists (select 1 from pg_class
               where oid = 'public.push_subscriptions'::regclass
                 and relrowsecurity and relforcerowsecurity)),
    ('push_subscriptions grants anon nothing',
      not exists (
        select 1
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'push_subscriptions'
           and grantee = 'anon')),
    ('push_subscriptions endpoint is unique',
      exists (select 1 from pg_indexes
               where schemaname = 'public'
                 and tablename = 'push_subscriptions'
                 and indexdef ilike '%unique%endpoint%'))
  ) as checks(invariant, ok)
 order by 1;

-- 14. The client-address and privilege invariants 0011 promises, stated over the
--     live schema. Both halves were measured failing before it ran: the limiter
--     took the leftmost x-forwarded-for element (a caller-supplied address, so a
--     burst with one invented IP per call was never throttled), and Supabase's
--     own default privileges handed TRUNCATE — which RLS does not constrain — to
--     every signed-in account.
select invariant, ok
  from (values
    ('limiter reads cf-connecting-ip',
      exists (select 1 from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'enforce_rate_limit'
                 and pg_get_functiondef(p.oid) like '%cf-connecting-ip%')),
    ('limiter never takes the leftmost x-forwarded-for element',
      not exists (select 1 from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname = 'enforce_rate_limit'
                     and pg_get_functiondef(p.oid)
                         ~ 'split_part\([^)]*x-forwarded-for[^)]*,\s*1\s*\)')),
    ('no client role may truncate, trigger or maintain a public table',
      not exists (select 1 from pg_class c
                    join pg_namespace n on n.oid = c.relnamespace
                    cross join lateral aclexplode(c.relacl) a
                    join pg_roles g on g.oid = a.grantee
                   where n.nspname = 'public'
                     and c.relkind in ('r', 'p')
                     and g.rolname in ('anon', 'authenticated')
                     and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'MAINTAIN'))),
    ('a table created next does not inherit those privileges',
      not exists (select 1 from pg_default_acl d
                    cross join lateral aclexplode(d.defaclacl) a
                    join pg_roles g on g.oid = a.grantee
                   where d.defaclnamespace = 'public'::regnamespace
                     and d.defaclobjtype = 'r'
                     and pg_get_userbyid(d.defaclrole) = 'postgres'
                     and g.rolname in ('anon', 'authenticated')
                     and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'MAINTAIN'))),
    ('signed-in clients keep their DML privileges',
      exists (select 1 from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                cross join lateral aclexplode(c.relacl) a
                join pg_roles g on g.oid = a.grantee
               where n.nspname = 'public'
                 and c.relname = 'class'
                 and g.rolname = 'authenticated'
                 and a.privilege_type = 'INSERT'))
  ) as checks(invariant, ok)
 order by 1;

-- 15. The abuse-report invariants 0013 promises, read out of the stored function
--     definition. The header comments of the migration file are not part of it,
--     and the body's own comments are worded so that none of them names the
--     variant this file removed — otherwise the second line below would be
--     satisfied or failed by documentation rather than by code.
select invariant, ok
  from (values
    ('the public report endpoint is throttled',
      exists (select 1 from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'report_link_abuse'
                 and pg_get_functiondef(p.oid) like '%enforce_rate_limit%')),
    ('its reply names no error variant that separates a real code from a guess',
      not exists (select 1 from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname = 'report_link_abuse'
                     and pg_get_functiondef(p.oid) like '%notFound%')),
    ('a row is filed only for a code that exists',
      exists (select 1 from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname = 'report_link_abuse'
                 and pg_get_functiondef(p.oid)
                     ~* '\bif[[:space:]]+found[[:space:]]+then\b'
                 and pg_get_functiondef(p.oid) like '%insert into abuse_report%')),
    ('and the report form is still reachable without signing in',
      has_function_privilege('anon', 'report_link_abuse(text, text)', 'EXECUTE'))
  ) as checks(invariant, ok)
 order by 1;
