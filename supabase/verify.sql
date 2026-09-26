-- Read-only checks to run in the Supabase SQL editor after 0001_init.sql.
-- Each query is meant to be read, not acted on: the expected result is in its
-- comment. Nothing here writes.

-- 1. Every table the app needs exists. Expected: 18 rows
--    (17 owner-scoped tables plus abuse_report).
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by 1;

-- 2. RLS is on and enforced for the owner. Expected: 17 rows, both columns true,
--    and abuse_report is deliberately absent from this list because it has no
--    owner-facing policy -- it must therefore have no rows reachable by anybody.
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
 order by 1;

-- 3. No table is missing its four owner policies. Expected: 0 rows.
with required(role) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
select t.tablename, r.role
  from pg_tables t
 cross join required r
 where t.schemaname = 'public'
   and t.tablename <> 'abuse_report'
   and not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.tablename
        and p.permutation = r.role
        and p.qual like '%auth.uid()%')
 order by 1, 2;

-- 4. `anon` can read nothing. Expected: 0 rows.
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon';

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

-- 8. No policy admits `anon`. RLS is off for anon by default (it holds no table
--    privileges at all, checks 4 and 5), so a row here means something granted
--    access twice over. Expected: 0 rows.
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and roles @> array['anon']
 order by 1, 2;

-- 9. Cross-tenant isolation, the test that actually matters. Expected: the
--    second statement raises "new row violates row-level security policy".
--    Run while signed in as user A in the SQL editor (the editor connects as
--    the authenticated role for your own jwt only in the API; in the SQL editor
--    you are postgres, so run this through the app instead):
--
--    insert into class (owner_id, name) values ('00000000-0000-0000-0000-000000000000'::uuid, 'not mine');
--
--    and confirm that a `select count(*) from class` for a second account never
--    returns the first account's rows.
