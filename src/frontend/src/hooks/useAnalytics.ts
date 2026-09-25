import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type { ActivityItem, AnalyticsBreakdown, DashboardStats } from "@/types";
import { useQuery } from "@tanstack/react-query";

const EMPTY_STATS: DashboardStats = {
  classCount: 0n,
  subjectCount: 0n,
  chapterCount: 0n,
  topicCount: 0n,
  questionCount: 0n,
};

const EMPTY_BREAKDOWN: AnalyticsBreakdown = {
  byClass: [],
  bySubject: [],
  byQuestionType: [],
};

/** Dashboard stat cards for the caller. */
export function useDashboardStats() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.dashboard.stats,
    queryFn: async (): Promise<DashboardStats> => {
      if (!actor) return EMPTY_STATS;
      return actor.getDashboardStats();
    },
    enabled: !!actor && !isFetching,
  });
}

/** Recent activity feed for the caller, newest first. */
export function useRecentActivity(limit = 8) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.dashboard.activity(limit),
    queryFn: async (): Promise<ActivityItem[]> => {
      if (!actor) return [];
      return actor.getRecentActivity(BigInt(limit));
    },
    enabled: !!actor && !isFetching,
  });
}

/** Accuracy breakdowns by class, subject, and question type. */
export function useAnalyticsBreakdown() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.analytics.breakdown,
    queryFn: async (): Promise<AnalyticsBreakdown> => {
      if (!actor) return EMPTY_BREAKDOWN;
      return actor.getAnalyticsBreakdown();
    },
    enabled: !!actor && !isFetching,
  });
}
