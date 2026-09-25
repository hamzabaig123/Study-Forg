import { type Backend, createActor } from "@/backend";
import { USE_LOCAL_ACCOUNTS } from "@/lib/authMode";
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
    created =
      import.meta.env.VITE_USE_MOCK === "true"
        ? createMockBackend()
        : createActorWithConfig(createActor, { mockModules });
    createdActors.set(client, created);
  }
  return created;
}

/**
 * The mock backend is loaded through `import.meta.glob` rather than by
 * `createActorWithConfig`'s own `mockModules` option: that helper checks
 * `VITE_USE_MOCK` inside `@caffeineai/core-infrastructure`, and Vite
 * pre-bundles that package without substituting env references, so the check
 * can never see the flag. Env vars are only inlined into files under `src`, so
 * the decision has to be made here.
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

function peekActor(client: QueryClient): Backend | undefined {
  const created = createBackendActor(client);
  return created instanceof Promise ? undefined : created;
}

/**
 * Resolve the mock backend actor before the first render needs it.
 *
 * Only the mock backend is pre-resolved (see `main.tsx`): it is a plain object
 * that exists independently of who is signed in, so waiting for it removes the
 * frame where every page reads nothing. A canister actor cannot be resolved
 * here because it belongs to the Internet Identity principal, which is still
 * being restored while the app mounts.
 */
export async function resolveBackendActor(
  client: QueryClient,
): Promise<Backend> {
  const created = createBackendActor(client);
  const actor = await created;
  client.setQueryData(ACTOR_KEY, actor);
  return actor;
}

/** One mock object shared by the whole app, so it is cached per `QueryClient`. */
function useMockBackend(): BackendState {
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

const MODE_SELECTED: () => BackendState = USE_LOCAL_ACCOUNTS
  ? useMockBackend
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
