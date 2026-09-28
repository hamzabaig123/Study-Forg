-- StudyForge 0009: web push subscriptions, one row per signed-in browser.
--
-- The reminder-sender Edge Function pushes the daily digest here before it
-- falls back to email: a subscription is per device (endpoint + the browser's
-- own key pair), so a user can have several rows and the push service itself
-- decides which desktops light up. Rows are created and removed by their
-- owner from the app's Settings → Reminders toggle; the sender reads them with
-- the service key, which is why no extra function grants exist here.
--
-- The harden block repeats 0001's, and this file deliberately ends with
-- nothing after it that could re-grant — 0006 taught the ordering trap, and
-- 0008 is what it took to fix. Idempotent per fresh table: run after 0007.

create table if not exists push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table push_subscriptions from public, anon;
grant select, insert, update, delete on push_subscriptions to authenticated;

alter table push_subscriptions enable row level security;
alter table push_subscriptions force row level security;

create policy owner_select_push_subscriptions on push_subscriptions
  for select to authenticated
  using (user_id = auth.uid() and owner_is_verified());
create policy owner_insert_push_subscriptions on push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid() and owner_is_verified());
create policy owner_update_push_subscriptions on push_subscriptions
  for update to authenticated
  using (user_id = auth.uid() and owner_is_verified())
  with check (user_id = auth.uid() and owner_is_verified());
create policy owner_delete_push_subscriptions on push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid() and owner_is_verified());

-- PostgREST caches the schema; without this the first insert answers 404 for
-- a table that exists.
notify pgrst, 'reload schema';
