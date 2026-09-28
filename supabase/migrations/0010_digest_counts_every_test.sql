-- StudyForge 0010: the digest counts the tests the account actually took.
--
-- `reminder_digest()` read one table — `result`, which is where a practice or
-- timed session started from the app's own library lands its score. A run built
-- in the Test Builder is graded in the browser and mirrored into
-- `custom_session` (0002) instead, and the dashboard, analytics and the browser
-- notification all merge the two. The email did not, so an account whose day
-- was spent on built tests was told "0%, 0 answered, 0-day streak" while its
-- own dashboard said 50% over 20 questions. Measured live on 2026-09-28.
--
-- This re-declares the function over both tables. Nothing else changes: the
-- same eight output columns, the same owner-scoped `security definer`, the
-- same service-role-only grants. Run after 0008 (which owns the lockdown this
-- file re-applies) and after 0002 (which creates `custom_session`).

create or replace function reminder_digest(p_owner uuid, p_offset_minutes integer)
returns table (
  accuracy_percent numeric,
  correct integer,
  answered integer,
  streak integer,
  best integer,
  tests_today integer,
  questions_today integer,
  question_bank integer
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_correct integer;
  v_total integer;
  v_days date[];
  v_today date := (now() + make_interval(mins => p_offset_minutes))::date;
  d date;
  v_prev date;
  v_run integer := 0;
  v_best integer := 0;
  v_current integer := 0;
  v_tests_today integer;
  v_questions_today integer;
  v_bank integer;
begin
  -- One pass over every completed test the account owns, whichever table the
  -- run landed in. `day` is computed once, in the account's own calendar, so
  -- the streak and the "today" figures below cannot disagree with each other.
  with attempts as (
    select r.score, r.total,
           (r.completed_at + make_interval(mins => p_offset_minutes))::date as day
      from result r
     where r.owner_id = p_owner
    union all
    select c.score, c.total,
           (c.completed_at + make_interval(mins => p_offset_minutes))::date as day
      from custom_session c
     where c.owner_id = p_owner
  )
  select coalesce(sum(score), 0),
         coalesce(sum(total), 0),
         array_agg(distinct day order by day),
         count(*) filter (where day = v_today)::integer,
         coalesce(sum(total) filter (where day = v_today), 0)::integer
    into v_correct, v_total, v_days, v_tests_today, v_questions_today
    from attempts;

  foreach d in array coalesce(v_days, array[]::date[]) loop
    if v_prev is not null and d = v_prev + 1 then v_run := v_run + 1;
    else v_run := 1;
    end if;
    if v_run > v_best then v_best := v_run; end if;
    v_prev := d;
  end loop;

  d := v_today;
  if not (d = any (coalesce(v_days, array[]::date[]))) then
    d := d - 1;
  end if;
  while d = any (coalesce(v_days, array[]::date[])) loop
    v_current := v_current + 1;
    d := d - 1;
  end loop;

  select count(*) into v_bank from question where owner_id = p_owner;

  return query select
    (case when v_total > 0 then round(v_correct::numeric * 100 / v_total) else 0 end),
    v_correct,
    v_total,
    v_current,
    greatest(v_best, v_current),
    v_tests_today,
    v_questions_today,
    v_bank;
end;
$$;

-- `create or replace` keeps the privileges the old function had, but this file
-- is also the one to re-assert them after a hand-applied 0008 or a fresh
-- database — the same walk-back 0006 forgot and 0008 had to undo. An
-- `authenticated` execute here would let any signed-in account read another
-- one's numbers, because the function answers for whichever `p_owner` it is
-- handed.
revoke all on function reminder_digest(uuid, integer) from public, anon, authenticated;
grant execute on function reminder_digest(uuid, integer) to service_role;

notify pgrst, 'reload schema';
