import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Common "../types/common";
import ContentTypes "../types/content";

module {
  /// Mutable state shared with the actor. Field names must match `main.mo`.
  public type State = {
    classes : Map.Map<Common.Id, ContentTypes.Class>;
    subjects : Map.Map<Common.Id, ContentTypes.Subject>;
    chapters : Map.Map<Common.Id, ContentTypes.Chapter>;
    topics : Map.Map<Common.Id, ContentTypes.Topic>;
    questions : Map.Map<Common.Id, Common.Question>;
    counters : { var nextId : Common.Id };
  };

  func nextId(state : State) : Common.Id {
    let id = state.counters.nextId;
    state.counters.nextId := id + 1;
    id;
  };

  func classSummary(state : State, c : ContentTypes.Class) : Common.ClassSummary {
    var count = 0;
    for (s in state.subjects.values()) {
      if (s.classId == c.id) { count += 1 };
    };
    {
      id = c.id;
      name = c.name;
      description = c.description;
      subjectCount = count;
      createdAt = c.createdAt;
      updatedAt = c.updatedAt;
    };
  };

  func subjectSummary(state : State, s : ContentTypes.Subject) : Common.SubjectSummary {
    var count = 0;
    for (c in state.chapters.values()) {
      if (c.subjectId == s.id) { count += 1 };
    };
    {
      id = s.id;
      classId = s.classId;
      name = s.name;
      description = s.description;
      chapterCount = count;
      createdAt = s.createdAt;
      updatedAt = s.updatedAt;
    };
  };

  func chapterSummary(state : State, c : ContentTypes.Chapter) : Common.ChapterSummary {
    var count = 0;
    for (t in state.topics.values()) {
      if (t.chapterId == c.id) { count += 1 };
    };
    {
      id = c.id;
      subjectId = c.subjectId;
      name = c.name;
      description = c.description;
      topicCount = count;
      createdAt = c.createdAt;
      updatedAt = c.updatedAt;
    };
  };

  func topicSummary(state : State, t : ContentTypes.Topic) : Common.TopicSummary {
    var count = 0;
    for (q in state.questions.values()) {
      if (q.topicId == t.id) { count += 1 };
    };
    {
      id = t.id;
      chapterId = t.chapterId;
      name = t.name;
      description = t.description;
      questionCount = count;
      createdAt = t.createdAt;
      updatedAt = t.updatedAt;
    };
  };

  func ownedClass(state : State, owner : Principal, classId : Common.Id) : ?ContentTypes.Class {
    switch (state.classes.get(classId)) {
      case (?c) { if (c.owner == owner) { ?c } else { null } };
      case null { null };
    };
  };

  func ownedSubject(state : State, owner : Principal, subjectId : Common.Id) : ?ContentTypes.Subject {
    switch (state.subjects.get(subjectId)) {
      case (?s) { if (s.owner == owner) { ?s } else { null } };
      case null { null };
    };
  };

  public func ownedChapter(state : State, owner : Principal, chapterId : Common.Id) : ?ContentTypes.Chapter {
    switch (state.chapters.get(chapterId)) {
      case (?c) { if (c.owner == owner) { ?c } else { null } };
      case null { null };
    };
  };

  public func ownedTopic(state : State, owner : Principal, topicId : Common.Id) : ?ContentTypes.Topic {
    switch (state.topics.get(topicId)) {
      case (?t) { if (t.owner == owner) { ?t } else { null } };
      case null { null };
    };
  };

  func ownedQuestion(state : State, owner : Principal, questionId : Common.Id) : ?Common.Question {
    switch (state.questions.get(questionId)) {
      case (?q) {
        switch (ownedTopic(state, owner, q.topicId)) {
          case (?_) { ?q };
          case null { null };
        };
      };
      case null { null };
    };
  };

  /// Remove every question belonging to `topicId`.
  public func deleteQuestionsOfTopic(state : State, topicId : Common.Id) {
    let doomed = List.empty<Common.Id>();
    for (q in state.questions.values()) {
      if (q.topicId == topicId) { doomed.add(q.id) };
    };
    for (id in doomed.values()) {
      state.questions.remove(id);
    };
  };

  /// Remove every topic of `chapterId` together with its questions.
  public func deleteTopicsOfChapter(state : State, chapterId : Common.Id) {
    let doomed = List.empty<Common.Id>();
    for (t in state.topics.values()) {
      if (t.chapterId == chapterId) { doomed.add(t.id) };
    };
    for (id in doomed.values()) {
      deleteQuestionsOfTopic(state, id);
      state.topics.remove(id);
    };
  };

  /// Remove every chapter of `subjectId` together with its descendants.
  public func deleteChaptersOfSubject(state : State, subjectId : Common.Id) {
    let doomed = List.empty<Common.Id>();
    for (c in state.chapters.values()) {
      if (c.subjectId == subjectId) { doomed.add(c.id) };
    };
    for (id in doomed.values()) {
      deleteTopicsOfChapter(state, id);
      state.chapters.remove(id);
    };
  };

  /// Remove every subject of `classId` together with its descendants.
  public func deleteSubjectsOfClass(state : State, classId : Common.Id) {
    let doomed = List.empty<Common.Id>();
    for (s in state.subjects.values()) {
      if (s.classId == classId) { doomed.add(s.id) };
    };
    for (id in doomed.values()) {
      deleteChaptersOfSubject(state, id);
      state.subjects.remove(id);
    };
  };

  /// List every class owned by `owner`, newest first.
  public func listClasses(state : State, owner : Principal) : [Common.ClassSummary] {
    let out = List.empty<Common.ClassSummary>();
    for (c in state.classes.values()) {
      if (c.owner == owner) { out.add(classSummary(state, c)) };
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  /// Create a class owned by `owner`.
  public func createClass(state : State, owner : Principal, name : Text, description : ?Text) : Common.ClassSummary {
    let now = Time.now();
    let c : ContentTypes.Class = {
      id = nextId(state);
      owner;
      name;
      description;
      createdAt = now;
      updatedAt = now;
    };
    state.classes.add(c.id, c);
    classSummary(state, c);
  };

  /// Rename (and optionally re-describe) a class.
  public func renameClass(state : State, owner : Principal, classId : Common.Id, name : Text, description : ?Text) : ?Common.ClassSummary {
    switch (ownedClass(state, owner, classId)) {
      case (?c) {
        let updated : ContentTypes.Class = {
          id = c.id;
          owner = c.owner;
          name;
          description;
          createdAt = c.createdAt;
          updatedAt = Time.now();
        };
        state.classes.add(classId, updated);
        ?classSummary(state, updated);
      };
      case null { null };
    };
  };

  /// Delete a class and every subject, chapter, topic, and question beneath it.
  public func deleteClass(state : State, owner : Principal, classId : Common.Id) : Bool {
    switch (ownedClass(state, owner, classId)) {
      case (?_) {
        deleteSubjectsOfClass(state, classId);
        state.classes.remove(classId);
        true;
      };
      case null { false };
    };
  };

  /// Detail view of a class with its subjects.
  public func getClass(state : State, owner : Principal, classId : Common.Id) : ?ContentTypes.ClassDetail {
    switch (ownedClass(state, owner, classId)) {
      case (?c) {
        ?{
          class_ = classSummary(state, c);
          subjects = listSubjects(state, owner, classId);
        };
      };
      case null { null };
    };
  };

  /// List every subject of a class.
  public func listSubjects(state : State, owner : Principal, classId : Common.Id) : [Common.SubjectSummary] {
    let out = List.empty<Common.SubjectSummary>();
    switch (ownedClass(state, owner, classId)) {
      case (?_) {
        for (s in state.subjects.values()) {
          if (s.classId == classId) { out.add(subjectSummary(state, s)) };
        };
      };
      case null {};
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  /// Create a subject inside a class.
  public func createSubject(state : State, owner : Principal, classId : Common.Id, name : Text, description : ?Text) : ?Common.SubjectSummary {
    switch (ownedClass(state, owner, classId)) {
      case (?_) {
        let now = Time.now();
        let s : ContentTypes.Subject = {
          id = nextId(state);
          owner;
          classId;
          name;
          description;
          createdAt = now;
          updatedAt = now;
        };
        state.subjects.add(s.id, s);
        ?subjectSummary(state, s);
      };
      case null { null };
    };
  };

  /// Rename (and optionally re-describe) a subject.
  public func renameSubject(state : State, owner : Principal, subjectId : Common.Id, name : Text, description : ?Text) : ?Common.SubjectSummary {
    switch (ownedSubject(state, owner, subjectId)) {
      case (?s) {
        let updated : ContentTypes.Subject = {
          id = s.id;
          owner = s.owner;
          classId = s.classId;
          name;
          description;
          createdAt = s.createdAt;
          updatedAt = Time.now();
        };
        state.subjects.add(subjectId, updated);
        ?subjectSummary(state, updated);
      };
      case null { null };
    };
  };

  /// Delete a subject and every chapter, topic, and question beneath it.
  public func deleteSubject(state : State, owner : Principal, subjectId : Common.Id) : Bool {
    switch (ownedSubject(state, owner, subjectId)) {
      case (?_) {
        deleteChaptersOfSubject(state, subjectId);
        state.subjects.remove(subjectId);
        true;
      };
      case null { false };
    };
  };

  /// Detail view of a subject with its chapters.
  public func getSubject(state : State, owner : Principal, subjectId : Common.Id) : ?ContentTypes.SubjectDetail {
    switch (ownedSubject(state, owner, subjectId)) {
      case (?s) {
        ?{
          subject = subjectSummary(state, s);
          chapters = listChapters(state, owner, subjectId);
        };
      };
      case null { null };
    };
  };

  /// List every chapter of a subject.
  public func listChapters(state : State, owner : Principal, subjectId : Common.Id) : [Common.ChapterSummary] {
    let out = List.empty<Common.ChapterSummary>();
    switch (ownedSubject(state, owner, subjectId)) {
      case (?_) {
        for (c in state.chapters.values()) {
          if (c.subjectId == subjectId) { out.add(chapterSummary(state, c)) };
        };
      };
      case null {};
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  /// Create a chapter inside a subject.
  public func createChapter(state : State, owner : Principal, subjectId : Common.Id, name : Text, description : ?Text) : ?Common.ChapterSummary {
    switch (ownedSubject(state, owner, subjectId)) {
      case (?_) {
        let now = Time.now();
        let c : ContentTypes.Chapter = {
          id = nextId(state);
          owner;
          subjectId;
          name;
          description;
          createdAt = now;
          updatedAt = now;
        };
        state.chapters.add(c.id, c);
        ?chapterSummary(state, c);
      };
      case null { null };
    };
  };

  /// Rename (and optionally re-describe) a chapter.
  public func renameChapter(state : State, owner : Principal, chapterId : Common.Id, name : Text, description : ?Text) : ?Common.ChapterSummary {
    switch (ownedChapter(state, owner, chapterId)) {
      case (?c) {
        let updated : ContentTypes.Chapter = {
          id = c.id;
          owner = c.owner;
          subjectId = c.subjectId;
          name;
          description;
          createdAt = c.createdAt;
          updatedAt = Time.now();
        };
        state.chapters.add(chapterId, updated);
        ?chapterSummary(state, updated);
      };
      case null { null };
    };
  };

  /// Delete a chapter and every topic and question beneath it.
  public func deleteChapter(state : State, owner : Principal, chapterId : Common.Id) : Bool {
    switch (ownedChapter(state, owner, chapterId)) {
      case (?_) {
        deleteTopicsOfChapter(state, chapterId);
        state.chapters.remove(chapterId);
        true;
      };
      case null { false };
    };
  };

  /// Detail view of a chapter with its topics.
  public func getChapter(state : State, owner : Principal, chapterId : Common.Id) : ?ContentTypes.ChapterDetail {
    switch (ownedChapter(state, owner, chapterId)) {
      case (?c) {
        ?{
          chapter = chapterSummary(state, c);
          topics = listTopics(state, owner, chapterId);
        };
      };
      case null { null };
    };
  };

  /// List every topic of a chapter.
  public func listTopics(state : State, owner : Principal, chapterId : Common.Id) : [Common.TopicSummary] {
    let out = List.empty<Common.TopicSummary>();
    switch (ownedChapter(state, owner, chapterId)) {
      case (?_) {
        for (t in state.topics.values()) {
          if (t.chapterId == chapterId) { out.add(topicSummary(state, t)) };
        };
      };
      case null {};
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  /// Create a topic inside a chapter.
  public func createTopic(state : State, owner : Principal, chapterId : Common.Id, name : Text, description : ?Text) : ?Common.TopicSummary {
    switch (ownedChapter(state, owner, chapterId)) {
      case (?_) {
        let now = Time.now();
        let t : ContentTypes.Topic = {
          id = nextId(state);
          owner;
          chapterId;
          name;
          description;
          createdAt = now;
          updatedAt = now;
        };
        state.topics.add(t.id, t);
        ?topicSummary(state, t);
      };
      case null { null };
    };
  };

  /// Rename (and optionally re-describe) a topic.
  public func renameTopic(state : State, owner : Principal, topicId : Common.Id, name : Text, description : ?Text) : ?Common.TopicSummary {
    switch (ownedTopic(state, owner, topicId)) {
      case (?t) {
        let updated : ContentTypes.Topic = {
          id = t.id;
          owner = t.owner;
          chapterId = t.chapterId;
          name;
          description;
          createdAt = t.createdAt;
          updatedAt = Time.now();
        };
        state.topics.add(topicId, updated);
        ?topicSummary(state, updated);
      };
      case null { null };
    };
  };

  /// Delete a topic and every question inside it.
  public func deleteTopic(state : State, owner : Principal, topicId : Common.Id) : Bool {
    switch (ownedTopic(state, owner, topicId)) {
      case (?_) {
        deleteQuestionsOfTopic(state, topicId);
        state.topics.remove(topicId);
        true;
      };
      case null { false };
    };
  };

  /// Detail view of a topic with its questions.
  public func getTopic(state : State, owner : Principal, topicId : Common.Id) : ?ContentTypes.TopicDetail {
    switch (ownedTopic(state, owner, topicId)) {
      case (?t) {
        ?{
          topic = topicSummary(state, t);
          questions = listQuestions(state, owner, topicId);
        };
      };
      case null { null };
    };
  };

  /// The class > subject > chapter > topic breadcrumb path for a topic.
  public func getTopicPath(state : State, owner : Principal, topicId : Common.Id) : ?ContentTypes.TopicPath {
    switch (ownedTopic(state, owner, topicId)) {
      case (?t) {
        switch (ownedChapter(state, owner, t.chapterId)) {
          case (?c) {
            switch (ownedSubject(state, owner, c.subjectId)) {
              case (?s) {
                switch (ownedClass(state, owner, s.classId)) {
                  case (?cl) {
                    ?{
                      class_ = { id = cl.id; name = cl.name };
                      subject = { id = s.id; name = s.name };
                      chapter = { id = c.id; name = c.name };
                      topic = { id = t.id; name = t.name };
                    };
                  };
                  case null { null };
                };
              };
              case null { null };
            };
          };
          case null { null };
        };
      };
      case null { null };
    };
  };

  /// List every question in a topic.
  public func listQuestions(state : State, owner : Principal, topicId : Common.Id) : [Common.Question] {
    let out = List.empty<Common.Question>();
    switch (ownedTopic(state, owner, topicId)) {
      case (?_) {
        for (q in state.questions.values()) {
          if (q.topicId == topicId) { out.add(q) };
        };
      };
      case null {};
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(a.createdAt, b.createdAt));
  };

  /// Create a question inside a topic.
  public func createQuestion(
    state : State,
    owner : Principal,
    topicId : Common.Id,
    prompt : Text,
    questionType : Common.QuestionType,
    answer : Common.AnswerData,
    explanation : ?Text,
  ) : ?Common.Question {
    switch (ownedTopic(state, owner, topicId)) {
      case (?_) {
        let now = Time.now();
        let q : Common.Question = {
          id = nextId(state);
          topicId;
          prompt;
          questionType;
          answer;
          explanation;
          createdAt = now;
          updatedAt = now;
        };
        state.questions.add(q.id, q);
        ?q;
      };
      case null { null };
    };
  };

  /// Edit an existing question.
  public func updateQuestion(
    state : State,
    owner : Principal,
    questionId : Common.Id,
    prompt : Text,
    questionType : Common.QuestionType,
    answer : Common.AnswerData,
    explanation : ?Text,
  ) : ?Common.Question {
    switch (ownedQuestion(state, owner, questionId)) {
      case (?q) {
        let updated : Common.Question = {
          id = q.id;
          topicId = q.topicId;
          prompt;
          questionType;
          answer;
          explanation;
          createdAt = q.createdAt;
          updatedAt = Time.now();
        };
        state.questions.add(questionId, updated);
        ?updated;
      };
      case null { null };
    };
  };

  /// Delete a question.
  public func deleteQuestion(state : State, owner : Principal, questionId : Common.Id) : Bool {
    switch (ownedQuestion(state, owner, questionId)) {
      case (?_) {
        state.questions.remove(questionId);
        true;
      };
      case null { false };
    };
  };

  /// Accept an AI-generated draft into a topic's question bank.
  public func acceptDraft(state : State, owner : Principal, topicId : Common.Id, draft : Common.DraftQuestion) : ?Common.Question {
    createQuestion(state, owner, topicId, draft.prompt, draft.questionType, draft.answer, draft.explanation);
  };
};
