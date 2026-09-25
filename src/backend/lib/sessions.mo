import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Result "mo:core/Result";
import Common "../types/common";
import SessionTypes "../types/sessions";
import ContentTypes "../types/content";
import ContentLib "content";

module {
  /// Mutable state shared with the actor. Field names must match `main.mo`.
  public type State = {
    classes : Map.Map<Common.Id, ContentTypes.Class>;
    subjects : Map.Map<Common.Id, ContentTypes.Subject>;
    chapters : Map.Map<Common.Id, ContentTypes.Chapter>;
    topics : Map.Map<Common.Id, ContentTypes.Topic>;
    questions : Map.Map<Common.Id, Common.Question>;
    sessions : Map.Map<Common.Id, SessionTypes.Session>;
    sessionResults : Map.Map<Common.Id, Common.SessionResult>;
    /// Submitted answers per session, keyed by session id then question id.
    sessionAnswers : Map.Map<Common.Id, Map.Map<Common.Id, Common.SubmittedAnswer>>;
    counters : { var nextId : Common.Id };
  };

  func nextId(state : State) : Common.Id {
    let id = state.counters.nextId;
    state.counters.nextId := id + 1;
    id;
  };

  func ownedSession(state : State, owner : Principal, sessionId : Common.Id) : ?SessionTypes.Session {
    switch (state.sessions.get(sessionId)) {
      case (?s) { if (s.owner == owner) { ?s } else { null } };
      case null { null };
    };
  };

  func optionsOf(q : Common.Question) : [Common.Option] {
    switch (q.answer) {
      case (#multipleChoice(mc)) { mc.options };
      case (_) { [] };
    };
  };

  func toSessionQuestion(q : Common.Question) : Common.SessionQuestion {
    {
      id = q.id;
      prompt = q.prompt;
      questionType = q.questionType;
      options = optionsOf(q);
    };
  };

  func toView(state : State, s : SessionTypes.Session) : Common.SessionView {
    let qs = List.empty<Common.SessionQuestion>();
    for (qid in s.questionIds.values()) {
      switch (state.questions.get(qid)) {
        case (?q) { qs.add(toSessionQuestion(q)) };
        case null {};
      };
    };
    {
      id = s.id;
      mode = s.mode;
      scope = s.scope;
      scopeLabel = s.scopeLabel;
      questions = qs.toArray();
      startedAt = s.startedAt;
      durationSeconds = s.durationSeconds;
      expiresAt = s.expiresAt;
    };
  };

  /// Collect the questions a session should draw from, in creation order.
  func poolFor(state : State, owner : Principal, scope : Common.SessionScope) : [Common.Question] {
    let topicIds = List.empty<Common.Id>();
    switch (scope) {
      case (#topic(topicId)) { topicIds.add(topicId) };
      case (#chapter(chapterId)) {
        for (t in state.topics.values()) {
          if (t.chapterId == chapterId) { topicIds.add(t.id) };
        };
      };
    };
    let out = List.empty<Common.Question>();
    for (q in state.questions.values()) {
      if (topicIds.contains(q.topicId)) {
        switch (ContentLib.ownedTopic(state, owner, q.topicId)) {
          case (?_) { out.add(q) };
          case null {};
        };
      };
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(a.createdAt, b.createdAt));
  };

  func scopeLabelFor(state : State, owner : Principal, scope : Common.SessionScope) : Text {
    switch (scope) {
      case (#topic(topicId)) {
        switch (ContentLib.ownedTopic(state, owner, topicId)) {
          case (?t) { t.name };
          case null { "Topic" };
        };
      };
      case (#chapter(chapterId)) {
        switch (ContentLib.ownedChapter(state, owner, chapterId)) {
          case (?c) { c.name };
          case null { "Chapter" };
        };
      };
    };
  };

  /// Start a practice session or timed test on a topic or chapter.
  public func startSession(state : State, owner : Principal, request : SessionTypes.StartSessionRequest) : Result.Result<Common.SessionView, Common.SessionError> {
    let scopeOk = switch (request.scope) {
      case (#topic(topicId)) { ContentLib.ownedTopic(state, owner, topicId) != null };
      case (#chapter(chapterId)) { ContentLib.ownedChapter(state, owner, chapterId) != null };
    };
    if (not scopeOk) { return #err(#notFound) };

    let pool = poolFor(state, owner, request.scope);
    if (pool.size() == 0) { return #err(#noQuestions) };

    let selected = switch (request.mode) {
      case (#practice) { pool };
      case (#timedTest) {
        let requested = request.questionCount ?? pool.size();
        if (requested == 0) { return #err(#invalidInput("questionCount must be greater than zero")) };
        let take = if (requested < pool.size()) { requested } else { pool.size() };
        pool.sliceToArray(0, take);
      };
    };

    let duration = switch (request.mode) {
      case (#practice) { null };
      case (#timedTest) {
        switch (request.durationSeconds) {
          case (?d) { if (d == 0) { return #err(#invalidInput("durationSeconds must be greater than zero")) } };
          case null { return #err(#invalidInput("durationSeconds is required for a timed test")) };
        };
        request.durationSeconds;
      };
    };

    let now = Time.now();
    let expiresAt = switch (duration) {
      case (?d) { ?(now + d.toInt() * 1_000_000_000) };
      case null { null };
    };

    let s : SessionTypes.Session = {
      id = nextId(state);
      owner;
      mode = request.mode;
      scope = request.scope;
      scopeLabel = scopeLabelFor(state, owner, request.scope);
      questionIds = selected.map(func q = q.id);
      startedAt = now;
      durationSeconds = duration;
      expiresAt;
      completed = false;
    };
    state.sessions.add(s.id, s);
    #ok(toView(state, s));
  };

  /// Fetch a live session, including its questions (answers withheld).
  public func getSession(state : State, owner : Principal, sessionId : Common.Id) : ?Common.SessionView {
    switch (ownedSession(state, owner, sessionId)) {
      case (?s) { ?toView(state, s) };
      case null { null };
    };
  };

  func grade(q : Common.Question, submitted : Common.SubmittedAnswer) : Bool {
    switch (q.answer, submitted) {
      case (#multipleChoice(mc), #multipleChoice(sa)) { mc.correctOptionId == sa.optionId };
      case (#trueFalse(tf), #trueFalse(sa)) { tf.correct == sa.value };
      case (#shortAnswer(sa), #shortAnswer(sub)) {
        sa.expected.trim(#predicate(func c = c == ' ')).toLower()
          == sub.text.trim(#predicate(func c = c == ' ')).toLower();
      };
      case (_) { false };
    };
  };

  /// Submit one answer and receive immediate feedback.
  public func submitAnswer(state : State, owner : Principal, request : SessionTypes.SubmitAnswerRequest) : Result.Result<SessionTypes.AnswerFeedback, Common.SessionError> {
    let session = switch (ownedSession(state, owner, request.sessionId)) {
      case (?s) { s };
      case null { return #err(#notFound) };
    };
    if (session.completed) { return #err(#invalidInput("session is already complete")) };
    switch (session.expiresAt) {
      case (?exp) { if (Time.now() > exp) { return #err(#invalidInput("time has expired")) } };
      case null {};
    };
    if (not session.questionIds.contains(request.questionId)) {
      return #err(#invalidInput("question is not part of this session"));
    };
    let q = switch (state.questions.get(request.questionId)) {
      case (?q) { q };
      case null { return #err(#notFound) };
    };
    let answers = switch (state.sessionAnswers.get(request.sessionId)) {
      case (?m) { m };
      case null {
        let m = Map.empty<Common.Id, Common.SubmittedAnswer>();
        state.sessionAnswers.add(request.sessionId, m);
        m;
      };
    };
    answers.add(request.questionId, request.answer);
    #ok({
      correct = grade(q, request.answer);
      correctAnswer = q.answer;
      explanation = q.explanation;
    });
  };

  /// Finish a session (or let a timed test auto-submit) and record its result.
  public func completeSession(state : State, owner : Principal, sessionId : Common.Id) : Result.Result<Common.SessionResult, Common.SessionError> {
    let session = switch (ownedSession(state, owner, sessionId)) {
      case (?s) { s };
      case null { return #err(#notFound) };
    };
    switch (state.sessionResults.get(sessionId)) {
      case (?existing) { return #ok(existing) };
      case null {};
    };

    let submittedForSession = state.sessionAnswers.get(sessionId);
    let results = List.empty<Common.QuestionResult>();
    var score = 0;
    for (qid in session.questionIds.values()) {
      switch (state.questions.get(qid)) {
        case (?q) {
          let submitted = switch (submittedForSession) {
            case (?m) { m.get(qid) };
            case null { null };
          };
          let isCorrect = switch (submitted) {
            case (?sa) { grade(q, sa) };
            case null { false };
          };
          if (isCorrect) { score += 1 };
          results.add({
            questionId = q.id;
            prompt = q.prompt;
            questionType = q.questionType;
            submitted;
            correct = isCorrect;
            correctAnswer = q.answer;
            explanation = q.explanation;
          });
        };
        case null {};
      };
    };

    let result : Common.SessionResult = {
      id = sessionId;
      mode = session.mode;
      scope = session.scope;
      score;
      total = results.size();
      startedAt = session.startedAt;
      completedAt = Time.now();
      results = results.toArray();
    };
    state.sessionResults.add(sessionId, result);
    state.sessions.remove(sessionId);
    state.sessionAnswers.remove(sessionId);
    #ok(result);
  };

  /// Fetch a recorded session result.
  public func getResult(state : State, owner : Principal, sessionId : Common.Id) : ?Common.SessionResult {
    switch (state.sessionResults.get(sessionId)) {
      case (?r) {
        // The live session is removed once completed, so ownership is checked
        // against the scope the result was recorded on.
        switch (r.scope) {
          case (#topic(topicId)) {
            switch (ContentLib.ownedTopic(state, owner, topicId)) {
              case (?_) { ?r };
              case null { null };
            };
          };
          case (#chapter(chapterId)) {
            switch (ContentLib.ownedChapter(state, owner, chapterId)) {
              case (?_) { ?r };
              case null { null };
            };
          };
        };
      };
      case null { null };
    };
  };
};
