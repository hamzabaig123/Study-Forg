import { InternetIdentityProvider } from "@caffeineai/core-infrastructure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BackendNotConfigured } from "./components/common/BackendNotConfigured";
import { resolveBackendActor } from "./hooks/useBackend";
import { DATA_BACKEND, SHARED_BACKEND } from "./lib/authMode";
import { registerPwa } from "./lib/pwa";
import { SUPABASE_CONFIGURED } from "./lib/supabase/env";
import "./index.css";

BigInt.prototype.toJSON = function () {
  return this.toString();
};

registerPwa();

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

const queryClient = new QueryClient();
const root = ReactDOM.createRoot(document.getElementById("root")!);

/**
 * Internet Identity is mounted only for a real canister.
 *
 * The provider reads the canister configuration as soon as it mounts, and neither
 * the dev mock backend nor the Supabase app has any — mounting it there would log
 * a configuration error on every reload for a session neither of them reads.
 */
const shell = SHARED_BACKEND ? (
  <App />
) : (
  <InternetIdentityProvider>
    <App />
  </InternetIdentityProvider>
);

/**
 * The shared backend is resolved before the first render.
 *
 * The mock and the Supabase adapter are plain objects that exist independently of
 * who is signed in, so waiting for them removes the frame where every page reads
 * nothing — which looks like a blank page or a false "nothing here yet" on every
 * route. For Supabase the wait also covers restoring the stored session: a query
 * that left as `anon` would be filtered to nothing by row level security and
 * cached as this account's data.
 *
 * A canister actor is not pre-resolved because it belongs to the Internet Identity
 * principal, which is still being restored while the app mounts; `useBackend`
 * creates it through `useActor` once there is one.
 */
function mount() {
  root.render(
    <QueryClientProvider client={queryClient}>{shell}</QueryClientProvider>,
  );
}

/**
 * A selected-but-unconfigured Supabase project is a setup state, not a runtime
 * error. Mounting the app anyway leaves every request answering 401 and the
 * screen blank, so the shell is replaced with the one instruction that fixes it.
 */
const supabaseRequested = DATA_BACKEND === "supabase" && !SUPABASE_CONFIGURED;

if (supabaseRequested) {
  root.render(<BackendNotConfigured />);
} else if (SHARED_BACKEND) {
  // Mount even if the backend module fails to load: the pages report that better
  // than a permanently blank screen.
  void resolveBackendActor(queryClient).then(mount, mount);
} else {
  mount();
}
