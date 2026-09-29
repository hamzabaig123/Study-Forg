import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";

module {
  type Id = Nat;
  type Timestamp = Int;

  type Option = { id : Id; text : Text };

  type QuestionType = { #multipleChoice; #trueFalse; #shortAnswer };

  type AnswerData = {
    #multipleChoice : { options : [Option]; correctOptionId : Id };
    #trueFalse : { correct : Bool };
    #shortAnswer : { expected : Text };
  };

  type Question = {
    id : Id;
    topicId : Id;
    prompt : Text;
    questionType : QuestionType;
    answer : AnswerData;
    explanation : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  type Class = {
    id : Id;
    owner : Principal;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  type Subject = {
    id : Id;
    owner : Principal;
    classId : Id;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  type Chapter = {
    id : Id;
    owner : Principal;
    subjectId : Id;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  type Topic = {
    id : Id;
    owner : Principal;
    chapterId : Id;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  type DraftQuestion = {
    id : Id;
    topicId : Id;
    prompt : Text;
    questionType : QuestionType;
    answer : AnswerData;
    explanation : ?Text;
  };

  type SessionMode = { #practice; #timedTest };
  type SessionScope = { #topic : Id; #chapter : Id };

  type Session = {
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

  type SubmittedAnswer = {
    #multipleChoice : { optionId : Id };
    #trueFalse : { value : Bool };
    #shortAnswer : { text : Text };
  };

  type QuestionResult = {
    questionId : Id;
    prompt : Text;
    questionType : QuestionType;
    submitted : ?SubmittedAnswer;
    correct : Bool;
    correctAnswer : AnswerData;
    explanation : ?Text;
  };

  type SessionResult = {
    id : Id;
    mode : SessionMode;
    scope : SessionScope;
    score : Nat;
    total : Nat;
    startedAt : Timestamp;
    completedAt : Timestamp;
    results : [QuestionResult];
  };

  type ShareTarget = { #chapter : Id; #topic : Id };

  type Share = {
    token : Text;
    owner : Principal;
    target : ShareTarget;
    createdAt : Timestamp;
  };

  type Note = {
    id : Id;
    owner : Principal;
    title : Text;
    subjectLabel : ?Text;
    chapterLabel : ?Text;
    topicLabel : ?Text;
    documentJson : Text;
    searchText : Text;
    status : Text;
    revision : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
    deletedAt : ?Timestamp;
  };

  type NoteShare = {
    token : Text;
    noteId : Id;
    owner : Principal;
    status : Text;
    createdAt : Timestamp;
  };

  type UserSettings = {
    owner : Principal;
    displayName : Text;
    studyGoal : Text;
    dailyTarget : Nat;
    appearance : Text;
    updatedAt : Timestamp;
  };

  type UserRole = { #admin; #user; #guest };

  type LinkStatus = { #active; #paused; #deleted };

  type ShortLink = {
    id : Id;
    code : Text;
    targetUrl : Text;
    editToken : Text;
    status : LinkStatus;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  type DeviceType = { #mobile; #tablet; #desktop; #other };

  type ScanRecord = {
    linkId : Id;
    scannedAt : Timestamp;
    device : DeviceType;
    country : ?Text;
  };

  type AbuseReport = {
    code : Text;
    reason : Text;
    reportedAt : Timestamp;
  };

  type AccessControlState = {
    var adminAssigned : Bool;
    userRoles : Map.Map<Principal, UserRole>;
  };

  type NewActor = {
    accessControlState : AccessControlState;
    classes : Map.Map<Id, Class>;
    subjects : Map.Map<Id, Subject>;
    chapters : Map.Map<Id, Chapter>;
    topics : Map.Map<Id, Topic>;
    questions : Map.Map<Id, Question>;
    aiKeys : Map.Map<Principal, Text>;
    drafts : Map.Map<Id, DraftQuestion>;
    sessions : Map.Map<Id, Session>;
    sessionResults : Map.Map<Id, SessionResult>;
    sessionAnswers : Map.Map<Id, Map.Map<Id, SubmittedAnswer>>;
    shares : Map.Map<Text, Share>;
    notes : Map.Map<Id, Note>;
    noteShares : Map.Map<Text, NoteShare>;
    settings : Map.Map<Principal, UserSettings>;
    links : Map.Map<Id, ShortLink>;
    scans : List.List<ScanRecord>;
    abuseReports : List.List<AbuseReport>;
    linkCounters : { var nextId : Id };
    counters : { var nextId : Id };
  };

  // The canister has never been deployed, so this chain has no state to replay
  // from: one migration, from the empty actor to the full shape. Folding the
  // earlier 120000 file in here is what `mops check`'s stable-interface gate
  // asked for ("2 pending migrations for check-limit=1").
  public func migration(_old : {}) : NewActor {
    {
      accessControlState = {
        var adminAssigned = false;
        userRoles = Map.empty();
      };
      classes = Map.empty();
      subjects = Map.empty();
      chapters = Map.empty();
      topics = Map.empty();
      questions = Map.empty();
      aiKeys = Map.empty();
      drafts = Map.empty();
      sessions = Map.empty();
      sessionResults = Map.empty();
      sessionAnswers = Map.empty();
      shares = Map.empty();
      notes = Map.empty();
      noteShares = Map.empty();
      settings = Map.empty();
      links = Map.empty();
      scans = List.empty();
      abuseReports = List.empty();
      linkCounters = { var nextId = 0 };
      counters = { var nextId = 0 };
    };
  };
};
