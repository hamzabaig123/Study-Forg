-- Read-only checks to run in the Supabase SQL editor after 0001_init.sql.
-- Each query is meant to be read, not acted on: the expected result is in its
-- comment. Nothing here writes.
--
-- e2e/apply-migration.mjs asserts numbers 1–7 over the Management API, so this
-- file is what a human runs when the script cannot (or when a printed count needs
-- to be read rather than compared). Number 8 is not a query: it points at
-- tests/rls_cross_tenant.sql, which the script also runs.

-- 1. Every table the app needs exists. Expected: 20 rows
--    (17 owner tables + abuse_report + rate_limit + custom_session)
--    (17 owner-scoped tables plus abuse_report).
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by 1;

-- 2. RLS is on and enforced for the owner. Expected: 20 rows, both columns true.
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
--    check in `with_check`, where `qual` is null.)
with required(role) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
select t.tablename, r.role
  from pg_tables t
 cross join required r
 where t.schemaname = 'public'
   and t.tablename not in ('abuse_report', 'rate_limit')
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
--    Expected: one row, both columns reading `{7,12}`. A mismatch means one
--    migration widened the column and not the function (or the reverse), which
--    reaches the UI as create_link answering `badCode` for a perfectly good
--    code. lib/supabase/sqlSurface.contract.test.ts is the offline twin of this
--    check: it compares the same regexes against SHORT_CODE_LENGTH.
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
