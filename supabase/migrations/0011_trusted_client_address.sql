-- StudyForge 0011: make the throttle key an address the client cannot choose,
-- and stop handing destructive table privileges to signed-in accounts.
--
-- 1. `enforce_rate_limit` keyed its window on `split_part(x-forwarded-for, ',', 1)`.
--    The leftmost entry of that header is whatever the caller wrote. Measured on
--    the live project 2026-09-28: 25 concurrent anonymous `create_link` calls
--    from one machine, no forged header, produced 20 accepted and 5 `rateLimited`;
--    the same burst carrying a distinct forged address per call produced 25
--    accepted, zero throttled, and 25 separate rows in `rate_limit` — one per
--    invented IP. Every public surface that rides on this limiter (`create_link`,
--    `resolve_link`, `link_detail_for_token`, `link_scan_stats_for_token`,
--    `shared_content`, `shared_note`) was therefore a suggestion rather than a
--    limit, which is the one thing standing between an anonymous caller and
--    brute-forcing a share code.
--
--    What the edge actually sends, read back out of `request.headers` through a
--    throwaway function (dropped again) rather than assumed:
--      * `cf-connecting-ip` — always the real peer, written by Cloudflare. A
--        client that sends the header itself is refused with HTTP 403 at the
--        edge, so it cannot be forged.
--      * `x-forwarded-for` — the caller's value(s) with the real peer appended,
--        so the last non-empty element is honest and the first is not.
--      * `x-real-ip` — only present on some routes; when the client sends it the
--        edge replaces it with the real peer anyway.
--      * `sb-forwarded-for` — a client-supplied value comes back as the real
--        peer, so Supabase overwrites it too.
--    Key order below is therefore cf-connecting-ip, then the last non-empty
--    x-forwarded-for element, then x-real-ip, then 'unknown' (a request with no
--    address at all is an Edge Function or a cron tick, which is what the
--    reminder digest sends).
-- 2. Supabase's own default privileges hand out `arwdDxtm` — the full table set,
--    including TRUNCATE, TRIGGER and (on PG 17) MAINTAIN — to `anon` and
--    `authenticated`. RLS does not apply to TRUNCATE, so a signed-in account
--    holding it can empty a table across every account no matter how the
--    policies read. Nothing in the app truncates or attaches a trigger (verified
--    against the adapter, both Edge Functions and the harnesses), and a blanket
--    revoke that leaves SELECT/INSERT/UPDATE/DELETE/REFERENCES in place costs the
--    adapter nothing. The existing grants go, and the default privileges for the
--    `postgres` role go with them, or the next table would quietly reinstate the
--    problem. (Tables created by `supabase_admin` — the dashboard's own editor
--    path — still inherit the old defaults; that entry is not reachable from the
--    role this migration runs as, so create tables through SQL files.)

-- ---------------------------------------------------------------------------
-- 1. The limiter, keyed on the address the edge vouches for.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_rate_limit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  v_headers jsonb := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
  v_cf      text    := nullif(trim(v_headers ->> 'cf-connecting-ip'), '');
  v_xff     text;
  v_ip      text;
  v_window  timestamptz := to_timestamp(
                 floor(extract(epoch from now()) / greatest(p_window_seconds, 1))
                 * greatest(p_window_seconds, 1));
  v_hits    integer;
begin
  if v_cf is null then
    -- The last address in the chain: everything before it was written by the
    -- caller. Blank elements are skipped so a trailing comma cannot hide it.
    select trim(e) into v_xff
      from unnest(string_to_array(v_headers ->> 'x-forwarded-for', ',')) with ordinality as t(e, at)
     where trim(e) <> ''
     order by at desc
     limit 1;
  end if;

  v_ip := coalesce(v_cf, v_xff, nullif(trim(v_headers ->> 'x-real-ip'), ''), 'unknown');

  -- Finished windows are history; deleting them on every hit keeps the table
  -- at (buckets x IPs seen this window) no matter how long the project runs.
  delete from rate_limit where bucket = p_bucket and window_start < v_window;
  insert into rate_limit (bucket, ip, window_start, hits)
    values (p_bucket, v_ip, v_window, 1)
    on conflict (bucket, ip, window_start)
    do update set hits = rate_limit.hits + 1
    returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'RATE_LIMITED: % requests this window for %', v_hits, p_bucket
      using errcode = 'P0001';
  end if;
end
$body$;

revoke all on function enforce_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Take the destructive table privileges back from the client roles.
--    MAINTAIN only exists from 17 on, and this file has to run on a staging
--    project that may not have caught up, so the statement is assembled.
-- ---------------------------------------------------------------------------
do $$
declare
  v_privs text := 'truncate, trigger'
             || case when current_setting('server_version_num')::int >= 170000
                      then ', maintain' else '' end;
  v_rel   regclass;
begin
  for v_rel in
    select c.oid::regclass
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format('revoke %s on table %s from anon, authenticated', v_privs, v_rel);
  end loop;

  -- And never again on a table this role creates. Without this the next
  -- migration's table arrives with TRUNCATE already granted, and the loop above
  -- has to be re-run by hand forever.
  execute format(
    'alter default privileges in schema public revoke %s on tables from anon, authenticated',
    v_privs);
end
$$;

notify pgrst, 'reload schema';
