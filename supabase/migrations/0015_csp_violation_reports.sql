-- 0015 — a place for the Content-Security-Policy to say what it blocked
--
-- The policy this app ships is generated from one module and names seven origins
-- the browser itself talks to. Every one of them is a feature: Gemini,
-- OpenRouter, pdf.js from a CDN, a local Ollama, the breach corpus behind the
-- password check, Turnstile, Speed Insights. A policy that refuses one of them
-- does not fail a build — it shows up as a request that dies in the visitor's
-- console, which nobody reports and the owner never sees. This table is how the
-- owner finds out: `report-to` in the header policy posts the refusals here,
-- through the `csp-collector` Edge Function.
--
-- Three shapes decided the schema, and two of them come from the caller being
-- anonymous:
--
--   1. **One row per distinct violation, not one row per report.** A page that
--      blocks the same script on every load would otherwise write a row per page
--      view, and an unauthenticated caller can reload a page as fast as it
--      likes. So the primary key *is* the violation and `hits` counts the reports
--      that named it: the table's size is bounded by the number of ways the
--      policy can be broken, not by traffic.
--   2. **Nothing that identifies a visitor is stored.** No `user_agent` (present
--      in every report, and a fingerprint), no full `blockedURL` (its path is
--      somebody's document), no `originalPolicy` (a copy of the policy, tens of
--      KB per report, already known), and the page is stored as a *route* with
--      its capability-bearing segment replaced — `/r/<code>`, `/manage/<token>`
--      and `/shared/<token>` name a real object, and this table is readable by
--      anyone with the SQL editor.
--   3. **A hard ceiling on distinct violations** (`v_full` below), because the
--      shape of a report is entirely the caller's choice. Past 5 000 tuples a new
--      violation is dropped and the ones already recorded keep counting: the
--      table answers "is the policy breaking a feature", and a flood of junk
--      tuples would answer nothing for anybody.
--
-- So a caller who writes directly learns "the policy refused `script-src`
-- against `evil.example` on `/notes`", and nothing else — which is the whole
-- point of the file.
--
-- The only writer is `csp-collector`, which calls this with the service key, so
-- `anon` and `authenticated` get no grant at all. That is the 0006/0008 lesson
-- applied before the fact: a blanket grant to the client roles turns a
-- service-only helper into a public endpoint.
--
-- Apply by pasting into the SQL editor (or `supabase/e2e/apply-migration.mjs`).
-- Until this file is in **and** the function is deployed **and** the header
-- carries `report-to`, nothing writes here — and an empty table then reads
-- exactly like "the policy blocks nothing". Check all three before believing the
-- first one; `verify.sql` #16 does.

create table if not exists csp_violation (
  directive    text        not null,
  blocked_host text        not null,
  route        text        not null,
  disposition  text        not null,
  hits         bigint      not null default 1 check (hits > 0),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  -- The bounds the collector applies, restated as the half that holds even when
  -- a future caller forgets to. Without them one report could put a megabyte in
  -- the columns that are supposed to name a directive.
  constraint csp_violation_fields_bounded check (
    char_length(directive)      between 1 and 80
    and char_length(blocked_host) between 1 and 255
    and char_length(route)        between 1 and 120
    and char_length(disposition)  between 1 and 16
  ),
  primary key (directive, blocked_host, route, disposition)
);

alter table csp_violation enable row level security;
alter table csp_violation force row level security;
-- No policies, like `rate_limit` and `abuse_report`: rows arrive only through the
-- definer helper below, and a client that could read the table would be reading
-- other people's traffic patterns off a shared deployment.

create or replace function record_csp_violations(p_reports jsonb) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full boolean;
  stored integer;
begin
  -- A batch, because the Reporting API sends an array and one page load can
  -- break the policy several ways. A body that is not an array is a malformed
  -- caller rather than a violation, and gets the same reply a real batch gets,
  -- so the endpoint teaches a probe nothing about which shape it accepts.
  if p_reports is null or jsonb_typeof(p_reports) <> 'array' then
    return jsonb_build_object('ok', 0);
  end if;

  -- 30 batches a minute. From an Edge Function the address the limiter keys on
  -- is the platform's egress address, not the visitor's, so this is a ceiling on
  -- the endpoint as a whole — "30 batches a minute, from everywhere" — which is
  -- precisely what protects the table from a caller holding the service key.
  if exists (
       select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'enforce_rate_limit'
     ) then
    begin
      perform enforce_rate_limit('record_csp_violations', 30, 60);
    exception when raise_exception then
      return jsonb_build_object('ok', 0);
    end;
  end if;

  -- Read once, before the loop, not per report.
  v_full := (select count(*) >= 5000 from csp_violation);

  with normalized as (
    select
      -- Both spellings, because both browsers ship both: Chrome moved to
      -- `effectiveDirective` and Firefox still sends `violatedDirective`. Either
      -- arriving names the same refusal.
      btrim(left(
        coalesce(nullif(directive, ''), nullif(directive_old, ''), 'unknown'),
        80
      )) as directive,
      -- The blocked address has already become a host in `shaped` and nothing
      -- else is kept: its path is somebody's document.
      coalesce(
        nullif(btrim(left(host, 255)), ''),
        '(none)'
      ) as blocked_host,
      -- The page becomes a route: scheme and host gone, the secret segment
      -- replaced, two path segments kept. `/notes/12/34` and `/notes/99/01` are
      -- the same place to whoever reads this table, and storing the tail would
      -- multiply rows per id without adding a fact.
      coalesce(
        nullif(regexp_replace(
          regexp_replace(route, '^/(r|manage|shared)/[^/]+', '/\1/(id)'),
          '^((/[^/]+){1,2}).*$',
          '\1'
        ), ''),
        '/'
      ) as route,
      btrim(left(coalesce(nullif(disposition, ''), 'enforce'), 16)) as disposition
    from (
      select
        directive,
        directive_old,
        disposition,
        -- A `data:`/`blob:`/`about:`/`javascript:` refusal has no host at all —
        -- the scheme is the whole useful fact, so it is stored as the value
        -- instead of dropped, which is what makes an `img-src data:` regression
        -- visible. Otherwise: drop the query and fragment, take the authority,
        -- then drop any userinfo the address carried.
        lower(btrim(
          case
            when blocked ~ '^(data|blob|about|javascript):'
              then split_part(blocked, ':', 1)
            else regexp_replace(
              split_part(split_part(split_part(blocked, '?', 1), '#', 1), '/', 3),
              '^[^@]*@',
              ''
            )
          end
        )) as host,
        -- `substring` returns null when the value has no scheme-and-authority to
        -- take a path out of, which is the caller's own document-less case.
        coalesce(
          substring(page from '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+(/[^?#]*)'),
          '/'
        ) as route
      from (
        select
          coalesce(
            nullif(report ->> 'blockedURL', ''),
            nullif(report ->> 'originalURL', ''),
            ''
          ) as blocked,
          coalesce(
            nullif(report ->> 'url', ''),
            nullif(report ->> 'documentURL', ''),
            ''
          ) as page,
          coalesce(nullif(report ->> 'effectiveDirective', ''), '') as directive,
          coalesce(nullif(report ->> 'violatedDirective', ''), '') as directive_old,
          coalesce(nullif(report ->> 'disposition', ''), '') as disposition
        from jsonb_array_elements(p_reports) as items(report)
        -- Same query level, so this runs before the target list touches `->>`.
        where jsonb_typeof(report) = 'object'
      ) raw
    ) shaped
  ),
  -- Collapsed within the batch, for two reasons that are the same reason: a
  -- browser can put two identical reports in one array, and an `insert ... on
  -- conflict do update` that touches one target row twice is an error, not a
  -- count of two. Grouping first makes a batch of five land as `hits + 5`.
  worth as (
    select
      directive,
      blocked_host,
      route,
      disposition,
      count(*)::bigint as hits
    from normalized
    group by 1, 2, 3, 4
  )
  insert into csp_violation (directive, blocked_host, route, disposition, hits)
  select w.directive, w.blocked_host, w.route, w.disposition, w.hits
  from worth w
  where not v_full
     or exists (
       select 1 from csp_violation seen
        where seen.directive    = w.directive
          and seen.blocked_host = w.blocked_host
          and seen.route        = w.route
          and seen.disposition  = w.disposition
     )
  on conflict (directive, blocked_host, route, disposition)
    do update set hits = csp_violation.hits + excluded.hits,
                  last_seen = now();

  get diagnostics stored = row_count;
  return jsonb_build_object('ok', stored);
end;
$$;

-- `create or replace function` carries an existing function's grants forward, so
-- these revoke the state a client role might have been left with rather than
-- assuming the file is running for the first time.
revoke all on function record_csp_violations(jsonb) from public;
revoke all on function record_csp_violations(jsonb) from anon;
revoke all on function record_csp_violations(jsonb) from authenticated;
grant execute on function record_csp_violations(jsonb) to service_role;

notify pgrst, 'reload schema';
