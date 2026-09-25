import Map "mo:core/Map";
import Result "mo:core/Result";
import Common "../types/common";
import ContentTypes "../types/content";
import SessionTypes "../types/sessions";
import SessionsLib "../lib/sessions";

mixin (
  classes : Map.Map<Common.Id, ContentTypes.Class>,
  subjects : Map.Map<Common.Id, ContentTypes.Subject>,
  chapters : Map.Map<Common.Id, ContentTypes.Chapter>,
  topics : Map.Map<Common.Id, ContentTypes.Topic>,
  questions : Map.Map<Common.Id, Common.Question>,
  sessions : Map.Map<Common.Id, SessionTypes.Session>,
  sessionResults : Map.Map<Common.Id, Common.SessionResult>,
  sessionAnswers : Map.Map<Common.Id, Map.Map<Common.Id, Common.SubmittedAnswer>>,
  counters : { var nextId : Common.Id },
) {
  transient let sessionState : SessionsLib.State = {
    classes;
    subjects;
    chapters;
    topics;
    questions;
    sessions;
    sessionResults;
    sessionAnswers;
    counters;
  };

  /// Start a practice session or timed test on a topic or chapter.
  public shared ({ caller }) func startSession(request : SessionTypes.StartSessionRequest) : async Result.Result<Common.SessionView, Common.SessionError> {
    SessionsLib.startSession(sessionState, caller, request);
  };

  /// Fetch a live session, including its questions (answers withheld).
  public shared ({ caller }) func getSession(sessionId : Common.Id) : async ?Common.SessionView {
    SessionsLib.getSession(sessionState, caller, sessionId);
  };

  /// Submit one answer and receive immediate feedback.
  public shared ({ caller }) func submitAnswer(request : SessionTypes.SubmitAnswerRequest) : async Result.Result<SessionTypes.AnswerFeedback, Common.SessionError> {
    SessionsLib.submitAnswer(sessionState, caller, request);
  };

  /// Finish a session (or let a timed test auto-submit) and record its result.
  public shared ({ caller }) func completeSession(sessionId : Common.Id) : async Result.Result<Common.SessionResult, Common.SessionError> {
    SessionsLib.completeSession(sessionState, caller, sessionId);
  };

  /// Fetch a recorded session result.
  public shared ({ caller }) func getSessionResult(sessionId : Common.Id) : async ?Common.SessionResult {
    SessionsLib.getResult(sessionState, caller, sessionId);
  };
};
