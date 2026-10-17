-- 0017 — take back the table grants 0015 never meant to give
--
-- `csp_violation` was designed with no client access at all: RLS forced, no
-- policies, and one definer writer that only `service_role` may call. But the
-- platform's default privileges grant every new table in `public` to `anon` and
-- `authenticated`, and 0015 revoked the function grants without revoking the
-- table ones. Measured live on 2026-10-18: both client roles held SELECT,
-- INSERT, UPDATE, DELETE and REFERENCES on it, which `verify.sql` #4 ("anon can
-- read nothing in the app schema") and #16 ("no client role holds any table
-- privilege on it") both report — #16 only once its `to_regfunction` typo,
-- which made it raise before reading a row, was corrected to `to_regprocedure`.
--
-- Forced RLS with no policies already answered every one of those privileges
-- with zero rows, so nothing was readable. This makes the grants say the same
-- thing the policies do, so the table no longer depends on one layer alone.

revoke all on table csp_violation from anon;
revoke all on table csp_violation from authenticated;

notify pgrst, 'reload schema';
