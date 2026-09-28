-- 0012 — Maroon Forge theme
--
-- The settings UI now offers a fourth appearance ("maroon"). The column's
-- CHECK in 0001 whitelists exactly three values, so without this the client
-- can save `maroon` locally but the account sync would be rejected on insert.
--
-- Additive and backwards-compatible: the three existing values keep working,
-- no row is rewritten, and re-running is a no-op because the alter simply
-- replaces the constraint with the same definition if applied twice.
--
-- As with every migration in this folder: apply by pasting into the SQL
-- editor (or via supabase/e2e/apply-migration.mjs). Until it is applied the
-- theme works fully device-local; only the account sync of `appearance =
-- 'maroon'` waits on it.

alter table public.user_settings
  drop constraint if exists user_settings_appearance_check;

alter table public.user_settings
  add constraint user_settings_appearance_check
  check (appearance in ('light', 'dark', 'frosted', 'maroon'));

notify pgrst, 'reload schema';
