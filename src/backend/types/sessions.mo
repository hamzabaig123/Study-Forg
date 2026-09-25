import Common "../types/common";

module {
  public type Id = Common.Id;
  public type Timestamp = Common.Timestamp;
  public type SessionMode = Common.SessionMode;
  public type SessionScope = Common.SessionScope;
  public type SessionQuestion = Common.SessionQuestion;
  public type SessionQuestionView = Common.SessionQuestionView;
  public type SessionView = Common.SessionView;
  public type SubmittedAnswer = Common.SubmittedAnswer;
  public type QuestionResult = Common.QuestionResult;
  public type SessionResult = Common.SessionResult;
  public type SessionError = Common.SessionError;

  /// A live practice session or timed test as stored.
  public type Session = {
    id : Id;
    owner : Principal;
    mode : SessionMode;
    scope : SessionScope;
    scopeLabel : Text;
    questionIds : [Id];
    startedAt : Timestamp;
    durationSeconds : ?Nat;
    expiresAt : ?Timestamp;
    completed : Bool;
  };

  /// A request to start a practice session or timed test.
  public type StartSessionRequest = {
    scope : SessionScope;
    mode : SessionMode;
    /// Number of questions to draw; ignored for practice (all questions are used).
    questionCount : ?Nat;
    /// Test duration in seconds; required for `#timedTest`.
    durationSeconds : ?Nat;
  };

  /// A request to submit one answer during a session.
  public type SubmitAnswerRequest = {
    sessionId : Id;
    questionId : Id;
    answer : SubmittedAnswer;
  };

  /// The immediate feedback returned for one practice answer.
  public type AnswerFeedback = {
    correct : Bool;
    correctAnswer : Common.AnswerData;
    explanation : ?Text;
  };
};
