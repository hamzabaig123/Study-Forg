import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReactDOM from "react-dom/client";
import App from "./App";
import { resolveBackendActor } from "./hooks/useBackend";
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
 * The canister actor is created asynchronously, so the app is mounted only once
 * it exists. Mounting earlier paints a first frame where every read has no data,
 * which looks like a blank page or a false "nothing here yet" on every route.
 */
root.render(
  <p className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
    Loading your workspace…
  </p>,
);

void resolveBackendActor(queryClient).finally(() => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
});
