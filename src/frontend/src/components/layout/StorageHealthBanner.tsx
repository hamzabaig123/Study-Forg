import {
  type StorageProblem,
  getStorageProblems,
  subscribeStorageHealth,
} from "@/lib/localStore";
import { AlertTriangle } from "lucide-react";
import { useSyncExternalStore } from "react";

/**
 * Not dismissible on purpose: every problem it reports means changes are being
 * lost right now, and hiding it would only re-hide the loss.
 */
export function StorageHealthBanner() {
  const problems = useSyncExternalStore(
    subscribeStorageHealth,
    getStorageProblems,
    getStorageProblems,
  );

  if (problems.length === 0) return null;

  return (
    <output
      data-ocid="storage.health_banner"
      className="mb-5 flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-800 dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {problems.map((problem: StorageProblem) => (
          <p key={problem.kind}>{problem.message}</p>
        ))}
      </div>
    </output>
  );
}
