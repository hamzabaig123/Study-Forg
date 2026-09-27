-- StudyForge 0007: grants the 0006 tables were missing, and the cron secret.
--
-- 0006 created reminder_settings and reminder_log but, like every migration
-- that creates tables, needed to repeat 0001's harden block — without it the
-- template grants answer 403 for the owner's own writes. This file is the
-- repeat, plus the CRON_SECRET the reminder-sender Edge Function checks so
-- only the scheduled pg_cron tick (or a signed-in user's test send) can fire.

grant select, insert, update, delete on reminder_settings to authenticated;
grant select on reminder_log to authenticated;

alter table reminder_settings enable row level security;
alter table reminder_settings force row level security;
alter table reminder_log enable row level security;
alter table reminder_log force row level security;

-- Re-assert the policy set (idempotent for fresh and already-migrated projects).
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
create policy owner_select_reminder_log on reminder_log
  for select to authenticated
  using (user_id = auth.uid() and owner_is_verified());
