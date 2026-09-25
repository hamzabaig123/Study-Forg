import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type { UserDataExport, UserSettingsView } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** The caller's study profile and appearance settings. */
export function useMySettings() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.settings.mine,
    queryFn: async (): Promise<UserSettingsView | null> => {
      if (!actor) return null;
      return actor.getMySettings();
    },
    enabled: !!actor && !isFetching,
  });
}

export interface SaveSettingsInput {
  displayName: string;
  studyGoal: string;
  dailyTarget: bigint;
  appearance: string;
}

/** Save the caller's settings. */
export function useSaveMySettings() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveSettingsInput) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.saveMySettings(
        input.displayName,
        input.studyGoal,
        input.dailyTarget,
        input.appearance,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.settings.mine,
      });
    },
  });
}

/** Export everything the caller stores as a downloadable JSON file. */
export function useExportMyData() {
  const { actor } = useBackend();
  return useMutation({
    mutationFn: async (): Promise<UserDataExport> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.exportMyData();
    },
  });
}
