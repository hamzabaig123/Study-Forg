-- StudyForge 0008: finish the helper walk-back 0006's own blanket grant undid.
--
-- 0006 walks `reminder_digest` and `due_reminders` back from every client role,
-- then further down re-runs 0001's harden block, whose blanket
-- `grant execute on all functions in schema public to authenticated`
-- re-grants both — the same ordering trap 0004 documented against 0002, this
-- time inside one file. 0006's blanket also re-granted `enforce_rate_limit`,
-- which 0005 had taken back. Measured live on 2026-09-28: a signed-in user
-- could execute `due_reminders()` and, whenever any account is due, read its
-- email, display name and settings across the whole project.
--
-- This file re-applies the revokes LAST, so order no longer matters, and it is
-- idempotent: safe on any project where 0006 exists, before or after 0007
-- (0007 touches only table grants and policies). Run it after 0006.

revoke all on function public.reminder_digest(uuid, integer) from public, anon, authenticated;
revoke all on function public.due_reminders() from public, anon, authenticated;
revoke all on function public.enforce_rate_limit(text, integer, integer) from public, anon, authenticated;

grant execute on function public.reminder_digest(uuid, integer) to service_role;
grant execute on function public.due_reminders() to service_role;

-- 0006's blanket landed after PostgREST cached the schema; a revoke that only
-- shows up after the cache reloads otherwise looks like it did nothing.
notify pgrst, 'reload schema';
