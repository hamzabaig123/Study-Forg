-- StudyForge 0006: per-account reminder settings, plus everything the server
-- needs to DELIVER the digest itself.
--
-- Two halves:
--
-- 1. reminder_settings — what follows the account: whether the daily digest is
--    on, the local time it fires (with the UTC offset captured from the
--    browser, so "19:00" means the learner's 19:00 on a server that runs in
--    UTC), which sections it carries, and the day it last fired.
--
-- 2. The delivery surface: reminder_log (every send attempt, success or
--    failure, for the Settings page to show) and two SECURITY DEFINER helpers
--    the reminder-sender Edge Function calls — one computes an account's
--    progress numbers, the other lists the accounts due on this tick. The
--    scheduled function runs with the service key and sends through Resend;
--    the recipient is always the account's own sign-in email.

create table reminder_settings (
  user_id            uuid        not null references auth.users (id) on delete cascade,
  enabled            boolean     not null default false,
  -- Local time of day, HH:MM 24-hour, the shape lib/reminders.ts stores.
  time_of_day        text        not null default '19:00'
                     check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Minutes EAST of UTC (the negated browser offset), so the sender can turn
  -- "19:00" into the learner's 19:00 no matter which zone they picked.
  utc_offset_minutes integer     not null default 0
                     check (utc_offset_minutes between -840 and 840),
  send_task_reminder boolean     not null default true,
  send_daily_report  boolean     not null default true,
  -- Local day key (YYYY-MM-DD) the digest last fired, what the scheduler
  -- compares against so it fires once per day.
  last_sent_on       text
                     check (last_sent_on ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  updated_at         timestamptz not null default now(),
  primary key (user_id)
);

-- One row per attempt. Written only by the delivery function (service role,
-- which row level security does not bind); read by its owner on the Settings
-- page, so "the email send is also in the database" is literal.
create table reminder_log (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  sent_at    timestamptz not null default now(),
  kind       text        not null check (kind in ('daily', 'test')),
  status     text        not null check (status in ('sent', 'failed')),
  detail     text
);

alter table reminder_settings enable row level security;
alter table reminder_settings force row level security;
alter table reminder_log enable row level security;
alter table reminder_log force row level security;

-- Same per-command shape as the content tables (see verify.sql check 3).
create policy owner_select_reminder_settings on reminder_settings
  for select to authenticated
  using (user_id = auth.uid() and owner_is_verified());
create policy owner_insert_reminder_settings on reminder_settings
  for insert to authenticated
  with check (user_id = auth.uid() and owner_is_verified());
create policy owner_update_reminder_settings on reminder_settings
  for update to authenticated
  using (user_id = auth.uid() and owner_is_verified())
  with check (user_id = auth.uid() and owner_is_verified());
create policy owner_delete_reminder_settings on reminder_settings
  for delete to authenticated
  using (user_id = auth.uid() and owner_is_verified());

-- The log: readable by the owner, never writable by a client. A fabricated
-- "sent" row would be a lie the Settings page would display.
create policy owner_select_reminder_log on reminder_log
  for select to authenticated
  using (user_id = auth.uid() and owner_is_verified());

create trigger reminder_settings_touch before update on reminder_settings
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- The delivery function's data access. Both are SECURITY DEFINER because the
-- scheduled tick arrives with the service key and must read across accounts;
-- every query inside is scoped by the owner it was handed.
-- ---------------------------------------------------------------------------

-- The numbers the digest email shows for one account. Streaks count a day when
-- any test completed, in the account's own calendar (their UTC offset comes
-- from the settings row), and the current streak survives an un-started today.
create function reminder_digest(p_owner uuid, p_offset_minutes integer)
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
  select coalesce(sum(score), 0), coalesce(sum(total), 0)
    into v_correct, v_total
    from result where owner_id = p_owner;

  select array_agg(day order by day) into v_days
    from (
      select distinct (completed_at + make_interval(mins => p_offset_minutes))::date as day
        from result where owner_id = p_owner
    ) days;

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

  select count(*), coalesce(sum(total), 0)
    into v_tests_today, v_questions_today
    from result
   where owner_id = p_owner
     and (completed_at + make_interval(mins => p_offset_minutes))::date = v_today;

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
-- SECURITY DEFINER and owner-addressed: it answers for whichever p_owner it is
-- handed, so a client that could call it could read any account's numbers. The
-- delivery function holds the service key; no role below it gets execute.
revoke all on function reminder_digest(uuid, integer) from public, anon, authenticated;
grant execute on function reminder_digest(uuid, integer) to service_role;

-- Everything whose digest should go out on this tick: enabled, the account's
-- local clock has reached its send time, today's digest has not gone out, and
-- the address belongs to a confirmed account.
create function due_reminders()
returns table (
  user_id uuid,
  time_of_day text,
  utc_offset_minutes integer,
  send_task_reminder boolean,
  send_daily_report boolean,
  email text,
  display_name text
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.user_id, s.time_of_day, s.utc_offset_minutes,
         s.send_task_reminder, s.send_daily_report,
         u.email,
         coalesce(nullif(btrim(us.display_name), ''), split_part(u.email, '@', 1))
    from reminder_settings s
    join auth.users u on u.id = s.user_id
    left join user_settings us on us.owner_id = s.user_id
   where s.enabled
     and u.email_confirmed_at is not null
     and (s.last_sent_on is distinct from
          to_char((now() + make_interval(mins => s.utc_offset_minutes))::date, 'YYYY-MM-DD'))
     and to_char((now() + make_interval(mins => s.utc_offset_minutes))::time, 'HH24:MI')
         >= s.time_of_day
   order by s.user_id;
$$;
-- Every account's address and send time in one reply: the scheduler's view, and
-- nothing a signed-in client has any business reading. service_role only.
revoke all on function due_reminders() from public, anon, authenticated;
grant execute on function due_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- Harden roles, again: this file created two tables, and Supabase's template
-- grants anon DML on every new public table. See 0001, bottom.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from public;
grant execute on all functions in schema public to authenticated;
-- The blanket grant above is exactly what 0004 step 8 and 0005 undo, so this
-- file has to undo it again for the functions that were never meant for a
-- client: the throttle and the two cross-account views the mail runner owns.
revoke all on function host_refused() from authenticated;
revoke all on function private_host_problem(text) from authenticated;
revoke all on function url_target_problem(text) from authenticated;
revoke all on function enforce_rate_limit(text, integer, integer) from authenticated;
revoke all on function reminder_digest(uuid, integer) from authenticated;
revoke all on function due_reminders() from authenticated;
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
