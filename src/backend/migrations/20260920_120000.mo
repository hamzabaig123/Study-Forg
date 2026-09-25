import Map "mo:core/Map";
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

  type UserRole = { #admin; #user; #guest };

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
    counters : { var nextId : Id };
  };

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
      counters = { var nextId = 0 };
    };
  };
};
