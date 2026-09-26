import { useBackend } from "@/hooks/useBackend";
import {
  type ImportProgress,
  type ImportReport,
  importArchive,
  parseArchive,
} from "@/lib/archiveImport";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface ImportInput {
  /** The archive as text: a chosen file, or the value under the local key. */
  text: string;
  /** Called after every row, so a page can show a bar rather than a spinner. */
  onProgress?: ImportProgress;
}

/**
 * Put an exported archive into the account the app is currently signed to.
 *
 * One hook for both entry points — a file the person picked and the archive this
 * browser already holds — because after `parseArchive` they are the same
 * document. Every query is invalidated on success: an import touches a dozen
 * cached lists and a partial refresh would leave the dashboard counting rows
 * that no longer match the pages.
 */
export function useImportArchive() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation<ImportReport, Error, ImportInput>({
    mutationFn: async ({ text, onProgress }) => {
      if (!actor) throw new Error("Backend is not ready");
      return importArchive(actor, parseArchive(text), onProgress);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
