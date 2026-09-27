-- StudyForge 0005: correctness pass over 0002's limiter, and dead-weight removal.
--
-- 1. enforce_rate_limit accepted p_window_seconds but computed its window with
--    date_trunc('minute', now()) — the parameter was dead. The window is now a
--    fixed epoch-aligned interval of exactly that many seconds, so a caller
--    asking for a 30- or 300-second window gets one.
-- 2. The ai_draft table was created for a server-side draft flow the app never
--    built: no adapter method reads or writes it (extraction drafts are a
--    device-local review queue, and the adapter's generateDrafts is an honest
--    refusal). An empty, unreachable table is attack surface and drift bait,
--    so it goes. If server-side drafts are ever designed, they deserve a
--    migration of their own.

create or replace function public.enforce_rate_limit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $body$
declare
  v_headers jsonb := coalesce(current_setting('request.headers', true)::jsonb, '{}'::jsonb);
  v_ip      text := coalesce(
                 split_part(v_headers ->> 'x-forwarded-for', ',', 1),
                 v_headers ->> 'x-real-ip',
                 'unknown');
  v_window  timestamptz := to_timestamp(
                 floor(extract(epoch from now()) / greatest(p_window_seconds, 1))
                 * greatest(p_window_seconds, 1));
  v_hits    integer;
begin
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

drop table if exists public.ai_draft;
