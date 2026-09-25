import { type Backend, createActor } from "@/backend";
import { createActorWithConfig } from "@caffeineai/core-infrastructure";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

const mockModules = import.meta.glob("../mocks/backend.{ts,tsx,js,jsx}");

const ACTOR_KEY = ["backend-actor"];

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
 * Resolve the backend actor before the first render needs it.
 *
 * The canister actor is created asynchronously, so `main.tsx` awaits this
 * before mounting: without it every page would paint one frame with no data,
 * which reads as a blank screen or a false "nothing here yet".
 */
export async function resolveBackendActor(
  client: QueryClient,
): Promise<Backend> {
  const created = createBackendActor(client);
  const actor = await created;
  client.setQueryData(ACTOR_KEY, actor);
  return actor;
}

/**
 * Single access point for the generated backend actor.
 *
 * `actor` is `null` until the bindings resolve; every query hook gates on
 * `enabled: !!actor && !isFetching` so nothing fires early.
 */
export function useBackend() {
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
