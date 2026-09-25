import { InternetIdentityProvider } from "@caffeineai/core-infrastructure";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import App from "./App";
import { resolveBackendActor } from "./hooks/useBackend";
import { USE_LOCAL_ACCOUNTS } from "./lib/authMode";
import "./index.css";

BigInt.prototype.toJSON = function () {
  return this.toString();
};

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
 * The provider reads the canister configuration as soon as it mounts, and the
 * dev mock backend has none — mounting it there would log a configuration error
 * on every reload for a session the mock app never reads.
 */
const shell = USE_LOCAL_ACCOUNTS ? (
  <App />
) : (
  <InternetIdentityProvider>
    <App />
  </InternetIdentityProvider>
);

/**
 * The mock backend is a plain object, so it is resolved before the first
 * render: mounting earlier paints a frame where every read has no data, which
 * looks like a blank page or a false "nothing here yet" on every route.
 *
 * A canister actor is not pre-resolved because it belongs to the signed-in
 * Internet Identity principal, which is still being restored while the app
 * mounts; `useBackend` creates it through `useActor` once there is one.
 */
function mount() {
  root.render(
    <QueryClientProvider client={queryClient}>{shell}</QueryClientProvider>,
  );
}

if (USE_LOCAL_ACCOUNTS) {
  // Mount even if the mock module fails to load: the pages report that better
  // than a permanently blank screen.
  void resolveBackendActor(queryClient).then(mount, mount);
} else {
  mount();
}
