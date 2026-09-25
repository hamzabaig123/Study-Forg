module {
  /// Stable identifier for every content entity (class, subject, chapter,
  /// topic, question, attempt).
  public type Id = Nat;

  /// Nanoseconds since the epoch (`Time.now()`).
  public type Timestamp = Int;

  /// A single multiple-choice option.
  public type Option = {
    id : Id;
    text : Text;
  };

  /// The kind of a question. `#multipleChoice` carries the option list and the
  /// id of the correct option; `#trueFalse` carries the correct boolean;
  /// `#shortAnswer` carries the expected answer text.
  public type QuestionType = {
    #multipleChoice;
    #trueFalse;
    #shortAnswer;
  };

  /// Answer payload for a question, matching its `QuestionType`.
  public type AnswerData = {
    #multipleChoice : { options : [Option]; correctOptionId : Id };
    #trueFalse : { correct : Bool };
    #shortAnswer : { expected : Text };
  };

  /// A question as stored and returned to its owner (answers included).
  public type Question = {
    id : Id;
    topicId : Id;
    prompt : Text;
    questionType : QuestionType;
    answer : AnswerData;
    explanation : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A question as shown in a public shared view: no answer data, no
  /// explanation, no owner-only metadata.
  public type PublicQuestion = {
    id : Id;
    prompt : Text;
    questionType : QuestionType;
    options : [Option];
  };

  /// A question as shown during a practice session or timed test: options are
  /// present for multiple choice, but the correct answer is withheld.
  public type SessionQuestion = {
    id : Id;
    prompt : Text;
    questionType : QuestionType;
    options : [Option];
  };

  /// The answer a learner submits for one question.
  public type SubmittedAnswer = {
    #multipleChoice : { optionId : Id };
    #trueFalse : { value : Bool };
    #shortAnswer : { text : Text };
  };

  /// Per-question outcome in a session or test result.
  public type QuestionResult = {
    questionId : Id;
    prompt : Text;
    questionType : QuestionType;
    submitted : ?SubmittedAnswer;
    correct : Bool;
    correctAnswer : AnswerData;
    explanation : ?Text;
  };

  /// The mode a session was run in.
  public type SessionMode = {
    #practice;
    #timedTest;
  };

  /// A completed practice session or timed test.
  public type SessionResult = {
    id : Id;
    mode : SessionMode;
    scope : SessionScope;
    score : Nat;
    total : Nat;
    startedAt : Timestamp;
    completedAt : Timestamp;
    results : [QuestionResult];
  };

  /// What a session or test was started on.
  public type SessionScope = {
    #topic : Id;
    #chapter : Id;
  };

  /// A public read-only share link target.
  public type ShareTarget = {
    #chapter : Id;
    #topic : Id;
  };

  /// A generated draft question awaiting accept/discard in AI Studio.
  public type DraftQuestion = {
    id : Id;
    topicId : Id;
    prompt : Text;
    questionType : QuestionType;
    answer : AnswerData;
    explanation : ?Text;
  };

  /// Which AI backend generated a draft.
  public type AiSource = {
    #platform;
    #personalKey;
  };

  /// A generated draft together with the source that produced it.
  public type GeneratedDraft = {
    draft : DraftQuestion;
    source : AiSource;
  };

  /// The AI configuration state surfaced to the frontend. The saved key is
  /// never returned — only whether one exists and a masked hint.
  public type AiConfigStatus = {
    hasPersonalKey : Bool;
    keyHint : ?Text;
  };

  /// Errors returned by AI Studio generation.
  public type AiError = {
    #notConfigured;
    #generationFailed : Text;
    #invalidRequest : Text;
  };

  /// Errors returned by content mutations.
  public type ContentError = {
    #notFound;
    #notAuthorized;
    #invalidInput : Text;
  };

  /// Errors returned by session and test operations.
  public type SessionError = {
    #notFound;
    #notAuthorized;
    #noQuestions;
    #invalidInput : Text;
  };

  /// Errors returned by share operations.
  public type ShareError = {
    #notFound;
    #notAuthorized;
  };

  /// Errors returned by export operations.
  public type ExportError = {
    #notFound;
    #notAuthorized;
    #empty;
  };

  /// A downloadable export of a topic or chapter.
  public type ExportFile = {
    filename : Text;
    mimeType : Text;
    content : Text;
  };

  /// A public read-only share link.
  public type ShareLink = {
    token : Text;
    target : ShareTarget;
    createdAt : Timestamp;
  };

  /// The public read-only payload behind a share token.
  public type SharedContent = {
    title : Text;
    breadcrumb : [BreadcrumbItem];
    questions : [PublicQuestion];
  };

  /// One level of a class > subject > chapter > topic path.
  public type BreadcrumbItem = {
    id : Id;
    name : Text;
  };

  /// A class with its subject count.
  public type ClassSummary = {
    id : Id;
    name : Text;
    description : ?Text;
    subjectCount : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A subject with its chapter count.
  public type SubjectSummary = {
    id : Id;
    classId : Id;
    name : Text;
    description : ?Text;
    chapterCount : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A chapter with its topic count.
  public type ChapterSummary = {
    id : Id;
    subjectId : Id;
    name : Text;
    description : ?Text;
    topicCount : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A topic with its question count.
  public type TopicSummary = {
    id : Id;
    chapterId : Id;
    name : Text;
    description : ?Text;
    questionCount : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// Counts shown on the dashboard stat cards.
  public type DashboardStats = {
    classCount : Nat;
    subjectCount : Nat;
    chapterCount : Nat;
    topicCount : Nat;
    questionCount : Nat;
  };

  /// One entry in the dashboard recent-activity feed.
  public type ActivityItem = {
    kind : Text;
    title : Text;
    at : Timestamp;
  };

  /// Accuracy for one breakdown bucket (a class, a subject, or a question type).
  public type AccuracyBucket = {
    bucketLabel : Text;
    correct : Nat;
    total : Nat;
    accuracyPercent : Float;
  };

  /// Accuracy broken down by class, subject, and question type.
  public type AnalyticsBreakdown = {
    byClass : [AccuracyBucket];
    bySubject : [AccuracyBucket];
    byQuestionType : [AccuracyBucket];
  };

  /// One row of practice/test attempt history.
  public type AttemptSummary = {
    id : Id;
    mode : SessionMode;
    scopeLabel : Text;
    score : Nat;
    total : Nat;
    completedAt : Timestamp;
  };

  /// A question being served during a session or test.
  public type SessionQuestionView = {
    question : SessionQuestion;
    index : Nat;
    total : Nat;
  };

  /// A live practice session or timed test.
  public type SessionView = {
    id : Id;
    mode : SessionMode;
    scope : SessionScope;
    scopeLabel : Text;
    questions : [SessionQuestion];
    startedAt : Timestamp;
    durationSeconds : ?Nat;
    expiresAt : ?Timestamp;
  };
};
