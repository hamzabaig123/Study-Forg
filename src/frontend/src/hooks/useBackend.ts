import { type Backend, createActor } from "@/backend";
import { DATA_BACKEND, SHARED_BACKEND } from "@/lib/authMode";
import {
  createActorWithConfig,
  useActor,
} from "@caffeineai/core-infrastructure";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

const mockModules = import.meta.glob("../mocks/backend.{ts,tsx,js,jsx}");

const supabaseModules = import.meta.glob(
  "../lib/supabase/supabaseBackend.{ts,tsx,js,jsx}",
);

const ACTOR_KEY = ["backend-actor"];

export interface BackendState {
  actor: Backend | null;
  isFetching: boolean;
  isReady: boolean;
}

/**
 * Created actors, one per `QueryClient`.
 *
 * `createActorWithConfig` is typed as a promise but returns the actor directly
 * when a test double or a synchronous platform mock stands in for it, so the
 * raw value is kept here: reading it during the first render lets `useBackend`
 * hand pages an actor immediately instead of one frame later.
 */
const createdActors = new WeakMap<QueryClient, Backend | Promise<Backend>>();

function createBackendActor(client: QueryClient): Backend | Promise<Backend> {
  let created = createdActors.get(client);
  if (!created) {
    created = selectBackend();
    createdActors.set(client, created);
  }
  return created;
}

function selectBackend(): Backend | Promise<Backend> {
  if (DATA_BACKEND === "supabase") {
    return loadSupabaseBackend();
  }
  if (DATA_BACKEND === "mock") {
    return createMockBackend();
  }
  return createActorWithConfig(createActor, { mockModules });
}

/**
 * The mock backend is loaded through `import.meta.glob` rather than by
 * `createActorWithConfig`'s own `mockModules` option: that helper checks
 * `VITE_USE_MOCK` inside `@caffeineai/core-infrastructure`, and Vite
 * pre-bundles that package without substituting env references, so the check
 * can never see the flag. Env vars are only inlined into files under `src`, so
 * the decision has to be made here.
 *
 * The same lazy `import.meta.glob` is used for the Supabase adapter, for a
 * different reason: it pulls in `@supabase/supabase-js`, and an app running on
 * the mock or the canister should not ship a client library it never calls.
 */
async function createMockBackend(): Promise<Backend> {
  const load = Object.values(mockModules)[0];
  const loaded = load
    ? ((await load()) as { mockBackend?: Backend })
    : undefined;
  if (!loaded?.mockBackend) {
    throw new Error("Mock backend is missing its `mockBackend` export");
  }
  return loaded.mockBackend;
}

async function loadSupabaseBackend(): Promise<Backend> {
  const load = Object.values(supabaseModules)[0];
  const loaded = load
    ? ((await load()) as { supabaseBackend?: () => Promise<Backend> })
    : undefined;
  if (!loaded?.supabaseBackend) {
    throw new Error("Supabase adapter is missing its `supabaseBackend` export");
  }
  return loaded.supabaseBackend();
}

function peekActor(client: QueryClient): Backend | undefined {
  const created = createBackendActor(client);
  return created instanceof Promise ? undefined : created;
}

/**
 * Resolve the shared backend before the first render needs it.
 *
 * Only a shared backend is pre-resolved (see `main.tsx`): the mock and the
 * Supabase adapter are plain objects that exist independently of who is signed
 * in, so waiting for them removes the frame where every page reads nothing. A
 * canister actor cannot be resolved here because it belongs to the Internet
 * Identity principal, which is still being restored while the app mounts.
 */
export async function resolveBackendActor(
  client: QueryClient,
): Promise<Backend> {
  const created = createBackendActor(client);
  const actor = await created;
  client.setQueryData(ACTOR_KEY, actor);
  return actor;
}

/** One object shared by the whole app, so it is cached per `QueryClient`. */
function useSharedBackend(): BackendState {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ACTOR_KEY,
    queryFn: () => createBackendActor(client),
    initialData: peekActor(client),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    actor: query.data ?? null,
    isFetching: query.isFetching,
    isReady: !!query.data && !query.isFetching,
  };
}

/**
 * Canister actor for the signed-in identity.
 *
 * `useActor` keys the actor to the principal and refetches every other query
 * when it changes, so signing in as someone else cannot leave the previous
 * user's data in the cache.
 */
function useCanisterBackend(): BackendState {
  const { actor, isFetching } = useActor(createActor, { mockModules });
  return {
    actor,
    isFetching,
    isReady: actor !== null && !isFetching,
  };
}

const MODE_SELECTED: () => BackendState = SHARED_BACKEND
  ? useSharedBackend
  : useCanisterBackend;

/**
 * Single access point for the backend actor.
 *
 * `actor` is `null` until it is available; every query hook gates on
 * `enabled: !!actor && !isFetching` so nothing fires early.
 */
export function useBackend(): BackendState {
  return MODE_SELECTED();
}
