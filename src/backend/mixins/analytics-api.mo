import Map "mo:core/Map";
import Common "../types/common";
import ContentTypes "../types/content";
import SessionTypes "../types/sessions";
import AnalyticsLib "../lib/analytics";

mixin (
  classes : Map.Map<Common.Id, ContentTypes.Class>,
  subjects : Map.Map<Common.Id, ContentTypes.Subject>,
  chapters : Map.Map<Common.Id, ContentTypes.Chapter>,
  topics : Map.Map<Common.Id, ContentTypes.Topic>,
  questions : Map.Map<Common.Id, Common.Question>,
  sessions : Map.Map<Common.Id, SessionTypes.Session>,
  sessionResults : Map.Map<Common.Id, Common.SessionResult>,
) {
  transient let analyticsState : AnalyticsLib.State = {
    classes;
    subjects;
    chapters;
    topics;
    questions;
    sessions;
    sessionResults;
  };

  /// Dashboard stat cards for the caller.
  public shared ({ caller }) func getDashboardStats() : async Common.DashboardStats {
    AnalyticsLib.getDashboardStats(analyticsState, caller);
  };

  /// Recent activity feed for the caller, newest first.
  public shared ({ caller }) func getRecentActivity(limit : Nat) : async [Common.ActivityItem] {
    AnalyticsLib.getRecentActivity(analyticsState, caller, limit);
  };

  /// Accuracy breakdowns by class, subject, and question type.
  public shared ({ caller }) func getAnalyticsBreakdown() : async Common.AnalyticsBreakdown {
    AnalyticsLib.getBreakdown(analyticsState, caller);
  };

  /// Practice and test attempt history, newest first.
  public shared ({ caller }) func getAttemptHistory() : async [Common.AttemptSummary] {
    AnalyticsLib.getAttemptHistory(analyticsState, caller);
  };
};
