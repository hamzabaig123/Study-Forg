-- 0013 — the abuse report stops being a free, unlimited probe
--
-- `report_link_abuse` is the one public RPC that answers a question about a
-- link the caller does not own, to `anon`, with no throttle. Two things were
-- wrong with that, and the second is the reason this file exists:
--
--   1. Nothing limited it. Every other public endpoint got a bucket in 0002 and
--      this one was missed, so an unauthenticated caller could write a
--      `abuse_report` row and bump `link.abuse_count` as fast as they could
--      send requests — a queue the owner has to read, filled by a stranger,
--      with no ceiling.
--   2. Its reply was an existence oracle. A code that is issued came back
--      `{"ok":null}` and a code that is not came back `{"err":"notFound"}`.
--      `/r/:code` is therefore a free "does this short code exist?" service,
--      callable by anyone, unlimited, for as long as they like — which spends
--      the entropy that #116 is raising: 48 bits is strong against a guess and
--      meaningless against an oracle. The scan endpoint does not have this
--      problem, because `resolve_link` already answers every unavailable state
--      with the same shape; the report endpoint did, because distinguishing
--      "you mistyped it" from "it never existed" looked helpful.
--
-- So: the same body either way, and a bucket like everywhere else.
--
-- **Order-sensitive:** this file may only be applied after 0002, because the
-- throttle branch calls `enforce_rate_limit`, and after 0011, because that is
-- the version of the limiter that keys on the address Cloudflare vouches for.
-- The `exists` guard keeps it runnable on a project that has neither, exactly
-- the way 0003 and 0004 handle it; on such a project the endpoint is simply
-- still unthrottled, which is what applying this file would otherwise buy.
--
-- Apply by pasting into the SQL editor (or `supabase/e2e/apply-migration.mjs`).
-- Until it is applied the live project still answers `notFound`, so the client
-- change that stops asking (`link_reported` copy stays as-is) is safe either
-- way: nothing on the front end depends on the distinction.

create or replace function report_link_abuse(p_code text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 20 per minute per address: a person filling in the form cannot reach it, a
  -- script can be told to stop. The name a stranger cannot see, and the shape
  -- is the one `abuseError` already understands — the union in
  -- `src/frontend/src/backend.ts` has `invalidInput` and `notFound`, and
  -- `invalidInput` is the branch allowed to carry a sentence.
  if exists (
       select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'enforce_rate_limit'
     ) then
    begin
      perform enforce_rate_limit('report_link_abuse', 20, 60);
    exception when raise_exception then
      return jsonb_build_object('err', jsonb_build_object('invalidInput', 'Too many reports from this connection — try again in a minute.'));
    end;
  end if;

  if p_code is null or p_code = '' then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'A short code is required.'));
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'Describe the problem with this link.'));
  end if;
  -- The column CHECK is 1..2000 and the form caps at 500, so this only ever
  -- bites a direct caller. Without the guard the insert raises 23514 out of a
  -- security-definer function, which reaches the visitor as an opaque error
  -- instead of the sentence they were given.
  if char_length(btrim(p_reason)) > 2000 then
    return jsonb_build_object('err', jsonb_build_object('invalidInput', 'Describe the problem with this link.'));
  end if;

  -- Counted and filed only when the link is real — that is the whole reason the
  -- reply used to distinguish a miss, and reading `found` after the update keeps
  -- the effect without returning it. A code that was never issued writes
  -- nothing: no row for a stranger to grow the table with, and nothing in the
  -- reply to tell them they missed. (The wording here is deliberate: `verify.sql`
  -- #15 asserts the stored body never names the old error variant, and a comment
  -- that quotes it would fail that check.)
  update link set abuse_count = abuse_count + 1 where code = p_code;
  if found then
    insert into abuse_report (code, reason) values (p_code, btrim(p_reason));
  end if;
  return jsonb_build_object('ok', null);
end;
$$;

-- `create or replace function` keeps the grants 0001/0002/0006 already gave, so
-- these lines restate the intended state rather than changing it — and they
-- stay explicit, because the house template (`grant execute on all functions in
-- schema public to …`) would also re-grant the two service-only reminder
-- helpers, which is the mistake 0006 made and 0008 walked back.
revoke all on function report_link_abuse(text, text) from public;
grant execute on function report_link_abuse(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
