-- StudyForge 0008: re-apply the walk-back 0006 states but this project never ran.
--
-- 0006 ends by granting execute on every public function to `authenticated` and
-- then walking that back, statement by statement, for the throttle and the two
-- cross-account reminder views. Measured live on 2026-09-28, though, a signed-in
-- user could execute `due_reminders()` and, whenever any account is due, read its
-- email, display name and settings across the whole project — and `reminder_digest`
-- and `enforce_rate_limit` were client-callable too. That is exactly the set the
-- walk-back names, so the pasted 0006 stopped at the blanket grant; the revokes
-- after it never ran. The committed file is not wrong (the replay in
-- src/frontend/src/lib/supabase/sqlSurface.contract.test.ts proves its own order
-- ends locked), which is why this file changes no function bodies and claims no
-- fix beyond the three revokes below.
--
-- Revokes come last, so nothing here can be undone by ordering, and every
-- statement is idempotent: safe on any project where 0006 exists, before or
-- after 0007 (0007 touches only table grants and policies). Run it after 0006.

revoke all on function public.reminder_digest(uuid, integer) from public, anon, authenticated;
revoke all on function public.due_reminders() from public, anon, authenticated;
revoke all on function public.enforce_rate_limit(text, integer, integer) from public, anon, authenticated;

grant execute on function public.reminder_digest(uuid, integer) to service_role;
grant execute on function public.due_reminders() to service_role;

-- 0006's blanket landed after PostgREST cached the schema; a revoke that only
-- shows up after the cache reloads otherwise looks like it did nothing.
notify pgrst, 'reload schema';
