-- StudyForge 0003: widen the short-code window so a code is not guessable.
--
-- 0001 constrained `link.code` to exactly 7 characters of a 31-symbol alphabet:
-- 31^7 = ~34.7 bits. That is small enough to probe over a long-lived public
-- `/r/:code` endpoint, which is the one surface with no session in front of it.
-- The client now mints 10 characters (31^10 = ~49.6 bits) and this file lets the
-- database accept it.
--
-- The column keeps `{7,12}` rather than `{10}` so every code already issued
-- still resolves, and so an owner may choose a shorter vanity code by hand.
--
-- Order matters, and this file must be last. 0002 replaces `create_link` with a
-- throttled body that still validates `p_code` against `^[2-9a-hjkmnp-z]{7}$`;
-- if that ran after this one it would quietly reinstall the 7-character
-- validator, and the failure would surface in the UI as create_link answering
-- `badCode` for a perfectly good 10-character code. So: 0001 → 0002 → 0003.
--
-- The body below is written to survive that ordering either way *in isolation*
-- too: it calls `enforce_rate_limit` only when that function exists, so a
-- project that applies 0001 → 0003 and never bothers with 0002 gets a working
-- (unthrottled) surface rather than a function that raises "function
-- enforce_rate_limit(text, integer, integer) does not exist" on every call.
--
--   0001 → 0002 → 0003   throttled and wide   (the intended state)
--   0001 → 0003          unthrottled and wide
-- Then run `supabase/verify.sql`; check 9 asserts the column CHECK and every
-- `create_link` guard agree with the length the frontend mints.

-- ---------------------------------------------------------------------------
-- 1. The column CHECK.
-- ---------------------------------------------------------------------------

-- 0001 declared it inline, so Postgres named it `link_code_check`. Drop by the
-- name actually in the catalogue rather than assuming, so a re-run — or a
-- project whose constraint was renamed by an earlier hand edit — still lands.
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

alter table link add constraint link_code_check check (code ~ '^[2-9a-hjkmnp-z]{7,12}$');

-- ---------------------------------------------------------------------------
-- 2. create_link: the same validator, widened, and throttle-tolerant.
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
  -- Present only once 0002 has been applied. Checked at run time, so this
  -- function starts throttling the moment that migration lands, without this
  -- file having to be re-run.
  if exists (
       select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'enforce_rate_limit'
     ) then
    perform enforce_rate_limit('create_link', 20, 60);
  end if;

  v_problem := url_target_problem(v_url);
  if v_problem is not null then
    return jsonb_build_object('err', jsonb_build_object('invalidUrl', v_problem));
  end if;
  -- The same range as the column CHECK above. Keep the two in step; check 9 of
  -- verify.sql compares them and the frontend's SHORT_CODE_LENGTH.
  if p_code is null or p_code !~ '^[2-9a-hjkmnp-z]{7,12}$' then
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
end;
$function$;

-- 0001 and 0002 both grant this; repeated here so 0001 → 0003 alone works.
revoke all on function public.create_link(text, text, text) from public;
grant execute on function public.create_link(text, text, text) to anon, authenticated;
