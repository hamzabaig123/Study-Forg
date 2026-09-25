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

  type OldActor = {
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
    counters : { var nextId : Id };
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

  public func migration(old : OldActor) : NewActor {
    {
      accessControlState = old.accessControlState;
      classes = old.classes;
      subjects = old.subjects;
      chapters = old.chapters;
      topics = old.topics;
      questions = old.questions;
      aiKeys = old.aiKeys;
      drafts = old.drafts;
      sessions = old.sessions;
      sessionResults = old.sessionResults;
      sessionAnswers = old.sessionAnswers;
      shares = old.shares;
      notes = Map.empty();
      noteShares = Map.empty();
      settings = Map.empty();
      links = Map.empty();
      scans = List.empty();
      abuseReports = List.empty();
      linkCounters = { var nextId = 0 };
      counters = old.counters;
    };
  };
};
