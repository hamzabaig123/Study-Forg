-- StudyForge 0014: a short code cannot be issued shorter than ten characters.
--
-- 0003 widened `link.code` from exactly 7 to `{7,12}` so the ten-character codes
-- the client had started minting would be accepted, and it deliberately left the
-- low end at 7 "so every code already issued still resolves, and so an owner may
-- choose a shorter vanity code by hand." That second clause is the hole: the
-- range is a *floor*, and a floor of 7 characters of a 31-symbol alphabet is
-- 31^7 = ~34.7 bits. `create_link` is granted to `anon`, so anyone — including
-- whoever is probing `/r/:code` — may call it with `p_code => 'aaaaaaa'` and get
-- a link whose address is guessable in a few hours of requests. The frontend
-- never does that, which is the only reason the number has not hurt yet; the
-- database's job is not to depend on the frontend's manners.
--
-- 0013 removed the other way to spend that entropy — a report against an
-- unissued code used to answer `notFound`, which turned the same endpoint into an
-- existence oracle — but a caller with an oracle and a caller who can *plant* a
-- short address both defeat a wide keyspace. So the floor moves to 10:
-- 31^10 = ~49.6 bits, which is what `lib/supabase/tokens.ts` has been minting
-- since 0003 and what `sqlSurface.contract.test.ts` already pins for the client.
--
-- **This refuses rather than repairs.** A live link whose code is shorter than
-- ten characters would fail the new CHECK, and 0003's own reasoning still holds
-- for the rows it let through: silently shortening nobody's URL is the whole
-- point of counting first and raising. If this file errors, the message names the
-- count. The fix is not to widen the CHECK back — it is to re-issue those links
-- (the owner creates a new one, the QR gets reprinted) or, if the row is
-- somebody's test data, to delete it and re-run.
--
-- Consequences worth knowing before it is applied:
--   * An **export from before 0003** can carry 7-character codes, and
--     `lib/archiveImport.ts` re-publishes links through `createLink`. Restoring
--     such an archive after this file lands reports those links as failures —
--     correctly, and with the code named — instead of writing a guessable
--     address into a public table.
--   * The **vanity code** idea dies with the low end. Anyone who wants a short,
--     memorable address should use a short *path* on their own domain and point
--     it at `/r/<ten chars>`.
--   * `resolve_link` never pattern-matched the code — it looks the row up by
--     value — so this file cannot break an existing link's resolution; it only
--     decides what may be created from now on.
--
-- Order: after 0003 (which set the `{7,12}` pair this replaces) and after 0004,
-- whose `create_link` is the newest declaration until this one. Like 0003, the
-- body calls `enforce_rate_limit` only when it exists, so a project that skipped
-- 0002 still gets a working — if unthrottled — surface.

-- ---------------------------------------------------------------------------
-- 1. Nothing may be shorter than the floor: count them before the ALTER does.
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_examples text;
begin
  select count(*) into v_count from link where char_length(code) < 10;
  if v_count > 0 then
    select string_agg(code, ', ' order by code) into v_examples
      from (select code from link where char_length(code) < 10 limit 5) short;
    raise exception
      'link.code cannot go to a 10-character floor: % existing link(s) are shorter (%) — re-issue them, or delete the rows if they are test data, then re-run this migration',
      v_count, v_examples;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The column CHECK. 0003 dropped 0001's inline constraint by the name in the
--    catalogue rather than assuming `link_code_check`; do the same, for the same
--    reason — a hand-edited project may have renamed it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
   where nsp.nspname = 'public'
     and cls.relname = 'link'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ~ 'code ~';
  if v_name is not null then
    execute format('alter table public.link drop constraint %I', v_name);
  end if;
end
$$;

alter table link add constraint link_code_check check (code ~ '^[2-9a-hjkmnp-z]{10,12}$');

-- ---------------------------------------------------------------------------
-- 3. create_link, restated over the new floor. `create or replace` keeps the
--    grants 0001/0002/0003/0004/0006 handed out, and the two lines below restate
--    the intended state explicitly — the template
--    `grant execute on all functions in schema public to …` would also re-grant
--    the service-only reminder helpers, which is the 0006 mistake 0008 walked
--    back.
-- ---------------------------------------------------------------------------

create or replace function public.create_link(p_target_url text, p_code text, p_edit_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
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
  -- The same range as the column CHECK above, and the same floor the client
  -- mints. Saying `badCode` for a seven-character code is the point: the
  -- answer the caller gets is the one the UI already has copy for.
  if p_code is null or p_code !~ '^[2-9a-hjkmnp-z]{10,12}$' then
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
    -- validator above, i.e. on a project where this file has not run yet.
    return jsonb_build_object('err', 'badCode');
end;
$function$;

revoke all on function public.create_link(text, text, text) from public;
grant execute on function public.create_link(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
