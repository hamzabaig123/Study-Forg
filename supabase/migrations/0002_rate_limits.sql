-- StudyForge 0002: per-IP rate limits on the anonymous token surface, and the
-- account-scoped custom_session table that lets test-builder results roam.
--
-- The guarded function bodies below are lifted verbatim from the live database
-- (pg_get_functiondef) at generation time, so they cannot drift from what 0001
-- actually deployed. If 0001 changes, regenerate this file rather than hand-edit.

-- ---------------------------------------------------------------------------
-- Rate limiting: a per-IP window the definer functions check first.
-- `request.headers` is set by PostgREST for every API request; direct SQL
-- (migrations, the editor) sees no headers and shares one bucket, which is
-- fine — the limit protects the public API surface, not operators.
-- ---------------------------------------------------------------------------
create table rate_limit (
  bucket       text        not null,
  ip           text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits > 0),
  primary key (bucket, ip, window_start)
);
alter table rate_limit enable row level security;
alter table rate_limit force row level security;
-- No policies, like abuse_report: rows are written only through the definer
-- helper below, and a client that could read the buckets would learn how much
-- traffic another token is getting.

create function enforce_rate_limit(p_bucket text, p_max integer, p_window_seconds integer) returns void
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
  v_window  timestamptz := date_trunc('minute', now());
  v_hits    integer;
begin
  -- Finished windows are history; deleting them on every hit keeps the table
  -- at (buckets x IPs seen this minute) no matter how long the project runs.
  delete from rate_limit where window_start < v_window;
  insert into rate_limit (bucket, ip, window_start, hits)
    values (p_bucket, v_ip, v_window, 1)
    on conflict (bucket, ip, window_start)
    do update set hits = rate_limit.hits + 1
    returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'RATE_LIMITED: % requests this minute for %', v_hits, p_bucket
      using errcode = 'P0001';
  end if;
end
$body$;
revoke all on function enforce_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- custom_session: the server mirror of a finished test-builder run. One row
-- per test, owned like every other table; the results payload is jsonb because
-- it is written and read whole, never queried column-wise.
-- ---------------------------------------------------------------------------
create table custom_session (
  id               text        primary key,
  owner_id         uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  mode             text        not null check (mode in ('practice', 'timedTest')),
  scope_label      text        not null,
  duration_seconds integer,
  started_at       timestamptz not null,
  completed_at     timestamptz not null,
  score            integer     not null check (score >= 0),
  total            integer     not null check (total > 0),
  results          jsonb       not null check (jsonb_typeof(results) = 'array'),
  created_at       timestamptz not null default now()
);
alter table custom_session enable row level security;
alter table custom_session force row level security;
create policy owner_select_custom_session on custom_session for select to authenticated
  using (owner_id = auth.uid() and owner_is_verified());
create policy owner_insert_custom_session on custom_session for insert to authenticated
  with check (owner_id = auth.uid() and owner_is_verified());
create policy owner_update_custom_session on custom_session for update to authenticated
  using (owner_id = auth.uid() and owner_is_verified())
  with check (owner_id = auth.uid() and owner_is_verified());
create policy owner_delete_custom_session on custom_session for delete to authenticated
  using (owner_id = auth.uid() and owner_is_verified());

-- Guarded token surface: the same functions 0001 deployed, each now checking
-- the caller's per-IP window before it touches a table.


CREATE OR REPLACE FUNCTION public.create_link(p_target_url text, p_code text, p_edit_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_url text := btrim(coalesce(p_target_url, ''));
  v_problem text;
  v_row link;
begin
  perform enforce_rate_limit('create_link', 20, 60);
  v_problem := url_target_problem(v_url);
  if v_problem is not null then
    return jsonb_build_object('err', jsonb_build_object('invalidUrl', v_problem));
  end if;
  if p_code is null or p_code !~ '^[2-9a-hjkmnp-z]{7}$' then
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
$function$
;

CREATE OR REPLACE FUNCTION public.link_detail_for_token(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_link link;
begin
  perform enforce_rate_limit('link_detail_for_token', 120, 60);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into v_link from link where edit_token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_link.id,
    'status', v_link.status,
    'code', v_link.code,
    'targetUrl', v_link.target_url,
    'shortUrl', '/r/' || v_link.code,
    'createdAt', v_link.created_at,
    'updatedAt', v_link.updated_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.link_scan_stats_for_token(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_link_id bigint;
begin
  perform enforce_rate_limit('link_scan_stats_for_token', 120, 60);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select id into v_link_id from link where edit_token_hash = p_token_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'totalScans', (select count(*) from link_scan where link_id = v_link_id),
    'perDay', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'count', count) order by day)
        from (select to_char(at at time zone 'utc', 'YYYY-MM-DD') as day, count(*) as count
                from link_scan
               where link_id = v_link_id
               group by 1) daily), '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_link(p_code text, p_device text DEFAULT 'other'::text, p_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_link link;
begin
  perform enforce_rate_limit('resolve_link', 60, 60);
  select * into v_link from link where code = p_code;
  if not found then
    return jsonb_build_object('unavailable', 'notFound');
  end if;
  if v_link.status = 'deleted' then
    return jsonb_build_object('unavailable', 'deleted');
  end if;
  if v_link.status = 'paused' then
    return jsonb_build_object('unavailable', 'paused');
  end if;
  insert into link_scan (owner_id, link_id, device, country)
       values (v_link.owner_id, v_link.id,
               case when p_device in ('desktop', 'tablet', 'mobile', 'other') then p_device else 'other' end,
               nullif(p_country, ''));
  return jsonb_build_object('targetUrl', v_link.target_url);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shared_content(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_share content_share;
  v_payload jsonb;
begin
  perform enforce_rate_limit('shared_content', 120, 60);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into v_share from content_share where token_hash = p_token_hash;
  if not found then
    return null;
  end if;

  if v_share.scope_kind = 'topic' then
    select jsonb_build_object(
             'title', tp.name,
             'breadcrumb', coalesce((
               select jsonb_build_array(
                        jsonb_build_object('id', c.id, 'name', c.name),
                        jsonb_build_object('id', s.id, 'name', s.name),
                        jsonb_build_object('id', ch.id, 'name', ch.name),
                        jsonb_build_object('id', tp.id, 'name', tp.name))
                 from chapter ch
                 join subject s on s.id = ch.subject_id
                 join class c on c.id = s.class_id
                where ch.id = tp.chapter_id), '[]'::jsonb),
             'questions', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', q.id,
                        'questionType', q.question_type,
                        'prompt', q.prompt,
                        'options', coalesce(q.answer -> 'multipleChoice' -> 'options', '[]'::jsonb))
                      order by q.id)
                 from question q
                where q.topic_id = tp.id), '[]'::jsonb)
           )
      into v_payload
      from topic tp
     where tp.id = v_share.scope_id
       and tp.owner_id = v_share.owner_id;
  else
    select jsonb_build_object(
             'title', ch.name,
             'breadcrumb', coalesce((
               select jsonb_build_array(
                        jsonb_build_object('id', c.id, 'name', c.name),
                        jsonb_build_object('id', s.id, 'name', s.name),
                        jsonb_build_object('id', ch.id, 'name', ch.name))
                 from subject s
                 join class c on c.id = s.class_id
                where s.id = ch.subject_id), '[]'::jsonb),
             'questions', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', q.id,
                        'questionType', q.question_type,
                        'prompt', q.prompt,
                        'options', coalesce(q.answer -> 'multipleChoice' -> 'options', '[]'::jsonb))
                      order by q.id)
                 from question q
                 join topic t on t.id = q.topic_id
                where t.chapter_id = ch.id), '[]'::jsonb)
           )
      into v_payload
      from chapter ch
     where ch.id = v_share.scope_id
       and ch.owner_id = v_share.owner_id;
  end if;

  if v_payload is null then
    -- The owner deleted the content but the share row outlived it: drop the
    -- dead share rather than hand back an empty shell.
    delete from content_share where token_hash = p_token_hash;
  end if;
  return v_payload;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shared_note(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_share note_share;
  v_payload jsonb;
begin
  perform enforce_rate_limit('shared_note', 120, 60);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into v_share from note_share where token_hash = p_token_hash;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
           'title', n.title,
           'documentJson', n.document_json,
           'revision', n.revision,
           'updatedAt', n.updated_at
         )
    into v_payload
    from note n
   where n.id = v_share.note_id
     and n.status = 'active'
     and n.owner_id = v_share.owner_id;

  if v_payload is null then
    delete from note_share where token_hash = p_token_hash;
  end if;
  return v_payload;
end;
$function$
;

-- The five helpers these functions use were left untouched: they are called
-- inside definer bodies or (for the grading pair) granted explicitly in 0001.

-- ---------------------------------------------------------------------------
-- Harden roles, again. 0001's block only reached tables that existed when it
-- ran, and Supabase's template grants anon DML on every new public table —
-- so every migration that creates one repeats this block. See 0001, bottom.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;
revoke all on function host_refused() from authenticated;
revoke all on function private_host_problem(text) from authenticated;
revoke all on function url_target_problem(text) from authenticated;
grant execute on function answer_is_correct(jsonb, jsonb) to authenticated;
grant execute on function normalize_answer_text(text) to authenticated;
grant execute on function shared_content(text) to anon;
grant execute on function shared_note(text) to anon;
grant execute on function resolve_link(text, text, text) to anon;
grant execute on function link_detail_for_token(text) to anon;
grant execute on function link_scan_stats_for_token(text) to anon;
grant execute on function link_set_paused(text, boolean) to anon;
grant execute on function link_update_target(text, text) to anon;
grant execute on function link_delete(text) to anon;
grant execute on function report_link_abuse(text, text) to anon;
grant execute on function create_link(text, text, text) to anon;
