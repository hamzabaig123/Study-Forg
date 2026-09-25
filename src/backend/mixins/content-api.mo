import Map "mo:core/Map";
import Common "../types/common";
import ContentTypes "../types/content";
import ContentLib "../lib/content";

mixin (
  classes : Map.Map<Common.Id, ContentTypes.Class>,
  subjects : Map.Map<Common.Id, ContentTypes.Subject>,
  chapters : Map.Map<Common.Id, ContentTypes.Chapter>,
  topics : Map.Map<Common.Id, ContentTypes.Topic>,
  questions : Map.Map<Common.Id, Common.Question>,
  counters : { var nextId : Common.Id },
) {
  transient let contentState : ContentLib.State = { classes; subjects; chapters; topics; questions; counters };

  /// List every class owned by the caller.
  public shared ({ caller }) func listClasses() : async [Common.ClassSummary] {
    ContentLib.listClasses(contentState, caller);
  };

  /// Create a class.
  public shared ({ caller }) func createClass(name : Text, description : ?Text) : async Common.ClassSummary {
    ContentLib.createClass(contentState, caller, name, description);
  };

  /// Rename (and optionally re-describe) a class.
  public shared ({ caller }) func renameClass(classId : Common.Id, name : Text, description : ?Text) : async ?Common.ClassSummary {
    ContentLib.renameClass(contentState, caller, classId, name, description);
  };

  /// Delete a class and all of its descendants.
  public shared ({ caller }) func deleteClass(classId : Common.Id) : async Bool {
    ContentLib.deleteClass(contentState, caller, classId);
  };

  /// Detail view of a class with its subjects.
  public shared ({ caller }) func getClass(classId : Common.Id) : async ?ContentTypes.ClassDetail {
    ContentLib.getClass(contentState, caller, classId);
  };

  /// List every subject of a class.
  public shared ({ caller }) func listSubjects(classId : Common.Id) : async [Common.SubjectSummary] {
    ContentLib.listSubjects(contentState, caller, classId);
  };

  /// Create a subject inside a class.
  public shared ({ caller }) func createSubject(classId : Common.Id, name : Text, description : ?Text) : async ?Common.SubjectSummary {
    ContentLib.createSubject(contentState, caller, classId, name, description);
  };

  /// Rename (and optionally re-describe) a subject.
  public shared ({ caller }) func renameSubject(subjectId : Common.Id, name : Text, description : ?Text) : async ?Common.SubjectSummary {
    ContentLib.renameSubject(contentState, caller, subjectId, name, description);
  };

  /// Delete a subject and all of its descendants.
  public shared ({ caller }) func deleteSubject(subjectId : Common.Id) : async Bool {
    ContentLib.deleteSubject(contentState, caller, subjectId);
  };

  /// Detail view of a subject with its chapters.
  public shared ({ caller }) func getSubject(subjectId : Common.Id) : async ?ContentTypes.SubjectDetail {
    ContentLib.getSubject(contentState, caller, subjectId);
  };

  /// List every chapter of a subject.
  public shared ({ caller }) func listChapters(subjectId : Common.Id) : async [Common.ChapterSummary] {
    ContentLib.listChapters(contentState, caller, subjectId);
  };

  /// Create a chapter inside a subject.
  public shared ({ caller }) func createChapter(subjectId : Common.Id, name : Text, description : ?Text) : async ?Common.ChapterSummary {
    ContentLib.createChapter(contentState, caller, subjectId, name, description);
  };

  /// Rename (and optionally re-describe) a chapter.
  public shared ({ caller }) func renameChapter(chapterId : Common.Id, name : Text, description : ?Text) : async ?Common.ChapterSummary {
    ContentLib.renameChapter(contentState, caller, chapterId, name, description);
  };

  /// Delete a chapter and all of its descendants.
  public shared ({ caller }) func deleteChapter(chapterId : Common.Id) : async Bool {
    ContentLib.deleteChapter(contentState, caller, chapterId);
  };

  /// Detail view of a chapter with its topics.
  public shared ({ caller }) func getChapter(chapterId : Common.Id) : async ?ContentTypes.ChapterDetail {
    ContentLib.getChapter(contentState, caller, chapterId);
  };

  /// List every topic of a chapter.
  public shared ({ caller }) func listTopics(chapterId : Common.Id) : async [Common.TopicSummary] {
    ContentLib.listTopics(contentState, caller, chapterId);
  };

  /// Create a topic inside a chapter.
  public shared ({ caller }) func createTopic(chapterId : Common.Id, name : Text, description : ?Text) : async ?Common.TopicSummary {
    ContentLib.createTopic(contentState, caller, chapterId, name, description);
  };

  /// Rename (and optionally re-describe) a topic.
  public shared ({ caller }) func renameTopic(topicId : Common.Id, name : Text, description : ?Text) : async ?Common.TopicSummary {
    ContentLib.renameTopic(contentState, caller, topicId, name, description);
  };

  /// Delete a topic and all of its questions.
  public shared ({ caller }) func deleteTopic(topicId : Common.Id) : async Bool {
    ContentLib.deleteTopic(contentState, caller, topicId);
  };

  /// Detail view of a topic with its questions.
  public shared ({ caller }) func getTopic(topicId : Common.Id) : async ?ContentTypes.TopicDetail {
    ContentLib.getTopic(contentState, caller, topicId);
  };

  /// The class > subject > chapter > topic breadcrumb path for a topic.
  public shared ({ caller }) func getTopicPath(topicId : Common.Id) : async ?ContentTypes.TopicPath {
    ContentLib.getTopicPath(contentState, caller, topicId);
  };

  /// List every question in a topic.
  public shared ({ caller }) func listQuestions(topicId : Common.Id) : async [Common.Question] {
    ContentLib.listQuestions(contentState, caller, topicId);
  };

  /// Create a question inside a topic.
  public shared ({ caller }) func createQuestion(
    topicId : Common.Id,
    prompt : Text,
    questionType : Common.QuestionType,
    answer : Common.AnswerData,
    explanation : ?Text,
  ) : async ?Common.Question {
    ContentLib.createQuestion(contentState, caller, topicId, prompt, questionType, answer, explanation);
  };

  /// Edit an existing question.
  public shared ({ caller }) func updateQuestion(
    questionId : Common.Id,
    prompt : Text,
    questionType : Common.QuestionType,
    answer : Common.AnswerData,
    explanation : ?Text,
  ) : async ?Common.Question {
    ContentLib.updateQuestion(contentState, caller, questionId, prompt, questionType, answer, explanation);
  };

  /// Delete a question.
  public shared ({ caller }) func deleteQuestion(questionId : Common.Id) : async Bool {
    ContentLib.deleteQuestion(contentState, caller, questionId);
  };

  /// Accept an AI-generated draft into a topic's question bank.
  public shared ({ caller }) func acceptDraft(topicId : Common.Id, draft : Common.DraftQuestion) : async ?Common.Question {
    ContentLib.acceptDraft(contentState, caller, topicId, draft);
  };
};
