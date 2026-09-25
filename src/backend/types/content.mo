import Common "../types/common";

module {
  public type Id = Common.Id;
  public type Timestamp = Common.Timestamp;
  public type Option = Common.Option;
  public type QuestionType = Common.QuestionType;
  public type AnswerData = Common.AnswerData;
  public type Question = Common.Question;
  public type PublicQuestion = Common.PublicQuestion;
  public type BreadcrumbItem = Common.BreadcrumbItem;
  public type ClassSummary = Common.ClassSummary;
  public type SubjectSummary = Common.SubjectSummary;
  public type ChapterSummary = Common.ChapterSummary;
  public type TopicSummary = Common.TopicSummary;
  public type ContentError = Common.ContentError;

  /// A class as stored.
  public type Class = {
    id : Id;
    owner : Principal;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A subject as stored.
  public type Subject = {
    id : Id;
    owner : Principal;
    classId : Id;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A chapter as stored.
  public type Chapter = {
    id : Id;
    owner : Principal;
    subjectId : Id;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A topic as stored.
  public type Topic = {
    id : Id;
    owner : Principal;
    chapterId : Id;
    name : Text;
    description : ?Text;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// The full detail view of a class, including its subjects.
  public type ClassDetail = {
    class_ : ClassSummary;
    subjects : [SubjectSummary];
  };

  /// The full detail view of a subject, including its chapters.
  public type SubjectDetail = {
    subject : SubjectSummary;
    chapters : [ChapterSummary];
  };

  /// The full detail view of a chapter, including its topics.
  public type ChapterDetail = {
    chapter : ChapterSummary;
    topics : [TopicSummary];
  };

  /// The full detail view of a topic, including its questions.
  public type TopicDetail = {
    topic : TopicSummary;
    questions : [Question];
  };

  /// The breadcrumb path to a topic, from class down to topic.
  public type TopicPath = {
    class_ : BreadcrumbItem;
    subject : BreadcrumbItem;
    chapter : BreadcrumbItem;
    topic : BreadcrumbItem;
  };
};
