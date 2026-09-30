import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Common "../types/common";
import ContentTypes "../types/content";
import SessionTypes "../types/sessions";

module {
  /// Mutable state shared with the actor. Field names must match `main.mo`.
  public type State = {
    classes : Map.Map<Common.Id, ContentTypes.Class>;
    subjects : Map.Map<Common.Id, ContentTypes.Subject>;
    chapters : Map.Map<Common.Id, ContentTypes.Chapter>;
    topics : Map.Map<Common.Id, ContentTypes.Topic>;
    questions : Map.Map<Common.Id, Common.Question>;
    questionsByTopic : Map.Map<Common.Id, List.List<Common.Id>>;
    sessions : Map.Map<Common.Id, SessionTypes.Session>;
    sessionResults : Map.Map<Common.Id, Common.SessionResult>;
  };

  func questionTypeText(qt : Common.QuestionType) : Text {
    switch (qt) {
      case (#multipleChoice) { "Multiple choice" };
      case (#trueFalse) { "True / false" };
      case (#shortAnswer) { "Short answer" };
    };
  };

  func modeText(mode : Common.SessionMode) : Text {
    switch (mode) {
      case (#practice) { "Practice" };
      case (#timedTest) { "Timed test" };
    };
  };

  func accuracy(correct : Nat, total : Nat) : Float {
    if (total == 0) { 0.0 } else { correct.toFloat() / total.toFloat() * 100.0 };
  };

  func ownedResults(state : State, owner : Principal) : [Common.SessionResult] {
    let out = List.empty<Common.SessionResult>();
    for (r in state.sessionResults.values()) {
      let owned = switch (r.scope) {
        case (#topic(topicId)) {
          switch (state.topics.get(topicId)) {
            case (?t) { t.owner == owner };
            case null { false };
          };
        };
        case (#chapter(chapterId)) {
          switch (state.chapters.get(chapterId)) {
            case (?c) { c.owner == owner };
            case null { false };
          };
        };
      };
      if (owned) { out.add(r) };
    };
    out.toArray();
  };

  /// Dashboard stat cards for `owner`.
  public func getDashboardStats(state : State, owner : Principal) : Common.DashboardStats {
    var classCount = 0;
    for (c in state.classes.values()) { if (c.owner == owner) { classCount += 1 } };
    var subjectCount = 0;
    for (s in state.subjects.values()) { if (s.owner == owner) { subjectCount += 1 } };
    var chapterCount = 0;
    for (c in state.chapters.values()) { if (c.owner == owner) { chapterCount += 1 } };
    var topicCount = 0;
    for (t in state.topics.values()) { if (t.owner == owner) { topicCount += 1 } };
    var questionCount = 0;
    for (t in state.topics.values()) {
      if (t.owner == owner) {
        switch (state.questionsByTopic.get(t.id)) {
          case (?l) { questionCount += l.size() };
          case null {};
        };
      };
    };
    { classCount; subjectCount; chapterCount; topicCount; questionCount };
  };

  /// Recent activity feed for `owner`, newest first.
  public func getRecentActivity(state : State, owner : Principal, limit : Nat) : [Common.ActivityItem] {
    let items = List.empty<Common.ActivityItem>();
    for (c in state.classes.values()) {
      if (c.owner == owner) {
        items.add({ kind = "class"; title = "Created class \"" # c.name # "\""; at = c.createdAt });
      };
    };
    for (s in state.subjects.values()) {
      if (s.owner == owner) {
        items.add({ kind = "subject"; title = "Created subject \"" # s.name # "\""; at = s.createdAt });
      };
    };
    for (c in state.chapters.values()) {
      if (c.owner == owner) {
        items.add({ kind = "chapter"; title = "Created chapter \"" # c.name # "\""; at = c.createdAt });
      };
    };
    for (t in state.topics.values()) {
      if (t.owner == owner) {
        items.add({ kind = "topic"; title = "Created topic \"" # t.name # "\""; at = t.createdAt });
      };
    };
    for (t in state.topics.values()) {
      if (t.owner == owner) {
        switch (state.questionsByTopic.get(t.id)) {
          case (?ids) {
            for (qid in ids.values()) {
              switch (state.questions.get(qid)) {
                case (?q) {
                  items.add({ kind = "question"; title = "Added a question to \"" # t.name # "\""; at = q.createdAt });
                };
                case null {};
              };
            };
          };
          case null {};
        };
      };
    };
    for (r in ownedResults(state, owner).values()) {
      items.add({
        kind = "session";
        title = modeText(r.mode) # " completed — " # r.score.toText() # "/" # r.total.toText();
        at = r.completedAt;
      });
    };
    let sorted = items.toArray().sort(func(a, b) = Int.compare(b.at, a.at));
    if (sorted.size() <= limit) { sorted } else { sorted.sliceToArray(0, limit) };
  };

  /// Accuracy breakdowns by class, subject, and question type.
  public func getBreakdown(state : State, owner : Principal) : Common.AnalyticsBreakdown {
    let results = ownedResults(state, owner);

    // ── by class ────────────────────────────────────────────────────────────
    let classCorrect = Map.empty<Common.Id, Nat>();
    let classTotal = Map.empty<Common.Id, Nat>();
    // ── by subject ──────────────────────────────────────────────────────────
    let subjectCorrect = Map.empty<Common.Id, Nat>();
    let subjectTotal = Map.empty<Common.Id, Nat>();
    // ── by question type ────────────────────────────────────────────────────
    let typeCorrect = Map.empty<Text, Nat>();
    let typeTotal = Map.empty<Text, Nat>();

    for (r in results.values()) {
      // Resolve the subject, and through it the class, this result belongs to.
      let (subjectId, _chapterId) = switch (r.scope) {
        case (#topic(topicId)) {
          switch (state.topics.get(topicId)) {
            case (?t) {
              switch (state.chapters.get(t.chapterId)) {
                case (?c) { (c.subjectId, c.id) };
                case null { (0, 0) };
              };
            };
            case null { (0, 0) };
          };
        };
        case (#chapter(chapterId)) {
          switch (state.chapters.get(chapterId)) {
            case (?c) { (c.subjectId, c.id) };
            case null { (0, 0) };
          };
        };
      };
      let classId = switch (state.subjects.get(subjectId)) {
        case (?s) { s.classId };
        case null { 0 };
      };

      for (qr in r.results.values()) {
        let correct = if (qr.correct) { 1 } else { 0 };
        if (classId != 0) {
          classCorrect.add(classId, (classCorrect.get(classId) ?? 0) + correct);
          classTotal.add(classId, (classTotal.get(classId) ?? 0) + 1);
        };
        if (subjectId != 0) {
          subjectCorrect.add(subjectId, (subjectCorrect.get(subjectId) ?? 0) + correct);
          subjectTotal.add(subjectId, (subjectTotal.get(subjectId) ?? 0) + 1);
        };
        let key = questionTypeText(qr.questionType);
        typeCorrect.add(key, (typeCorrect.get(key) ?? 0) + correct);
        typeTotal.add(key, (typeTotal.get(key) ?? 0) + 1);
      };
    };

    let byClass = List.empty<Common.AccuracyBucket>();
    for ((id, total) in classTotal.entries()) {
      let correct = classCorrect.get(id) ?? 0;
      let name = switch (state.classes.get(id)) {
        case (?c) { c.name };
        case null { "Class " # id.toText() };
      };
      byClass.add({ bucketLabel = name; correct; total; accuracyPercent = accuracy(correct, total) });
    };
    let bySubject = List.empty<Common.AccuracyBucket>();
    for ((id, total) in subjectTotal.entries()) {
      let correct = subjectCorrect.get(id) ?? 0;
      let name = switch (state.subjects.get(id)) {
        case (?s) { s.name };
        case null { "Subject " # id.toText() };
      };
      bySubject.add({ bucketLabel = name; correct; total; accuracyPercent = accuracy(correct, total) });
    };
    let byQuestionType = List.empty<Common.AccuracyBucket>();
    for ((key, total) in typeTotal.entries()) {
      let correct = typeCorrect.get(key) ?? 0;
      byQuestionType.add({ bucketLabel = key; correct; total; accuracyPercent = accuracy(correct, total) });
    };

    {
      byClass = byClass.toArray();
      bySubject = bySubject.toArray();
      byQuestionType = byQuestionType.toArray();
    };
  };

  /// Practice and test attempt history, newest first.
  public func getAttemptHistory(state : State, owner : Principal) : [Common.AttemptSummary] {
    let out = List.empty<Common.AttemptSummary>();
    for (r in ownedResults(state, owner).values()) {
      let scopeLabel = switch (r.scope) {
        case (#topic(topicId)) {
          switch (state.topics.get(topicId)) {
            case (?t) { t.name };
            case null { "Topic" };
          };
        };
        case (#chapter(chapterId)) {
          switch (state.chapters.get(chapterId)) {
            case (?c) { c.name };
            case null { "Chapter" };
          };
        };
      };
      out.add({
        id = r.id;
        mode = r.mode;
        scopeLabel;
        score = r.score;
        total = r.total;
        completedAt = r.completedAt;
      });
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(b.completedAt, a.completedAt));
  };
};
