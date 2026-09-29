import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Random "mo:core/Random";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Result "mo:core/Result";
import Common "../types/common";
import ContentTypes "../types/content";
import ShareTypes "../types/sharing";

module {
  /// Mutable state shared with the actor. Field names must match `main.mo`.
  public type State = {
    classes : Map.Map<Common.Id, ContentTypes.Class>;
    subjects : Map.Map<Common.Id, ContentTypes.Subject>;
    chapters : Map.Map<Common.Id, ContentTypes.Chapter>;
    topics : Map.Map<Common.Id, ContentTypes.Topic>;
    questions : Map.Map<Common.Id, Common.Question>;
    shares : Map.Map<Text, ShareTypes.Share>;
    counters : { var nextId : Common.Id };
  };

  /// URL-safe alphabet for share tokens (no padding, no ambiguous separators).
  let tokenAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  /// Number of random characters in a share token.
  let tokenLength = 24;

  /// Generate a long random URL-safe token. Uses the platform CSPRNG so a
  /// token cannot be guessed or enumerated from another one.
  func newToken() : async Text {
    let alphabet = tokenAlphabet.toArray();
    var token = "";
    var i = 0;
    while (i < tokenLength) {
      let index = await Random.natRange(0, alphabet.size());
      token := token # Char.toText(alphabet[index]);
      i += 1;
    };
    token;
  };

  func ownedChapter(state : State, owner : Principal, chapterId : Common.Id) : ?ContentTypes.Chapter {
    switch (state.chapters.get(chapterId)) {
      case (?c) { if (c.owner == owner) { ?c } else { null } };
      case null { null };
    };
  };

  func ownedTopic(state : State, owner : Principal, topicId : Common.Id) : ?ContentTypes.Topic {
    switch (state.topics.get(topicId)) {
      case (?t) { if (t.owner == owner) { ?t } else { null } };
      case null { null };
    };
  };

  func targetOwned(state : State, owner : Principal, target : Common.ShareTarget) : Bool {
    switch (target) {
      case (#chapter(chapterId)) { ownedChapter(state, owner, chapterId) != null };
      case (#topic(topicId)) { ownedTopic(state, owner, topicId) != null };
    };
  };

  func targetKey(target : Common.ShareTarget) : Text {
    switch (target) {
      case (#chapter(chapterId)) { "chapter:" # chapterId.toText() };
      case (#topic(topicId)) { "topic:" # topicId.toText() };
    };
  };

  func toLink(s : ShareTypes.Share) : Common.ShareLink {
    { token = s.token; target = s.target; createdAt = s.createdAt };
  };

  func publicQuestion(q : Common.Question) : Common.PublicQuestion {
    let options = switch (q.answer) {
      case (#multipleChoice(mc)) { mc.options };
      case (_) { [] };
    };
    { id = q.id; prompt = q.prompt; questionType = q.questionType; options };
  };

  func questionsOfTopic(state : State, topicId : Common.Id) : [Common.Question] {
    let out = List.empty<Common.Question>();
    for (q in state.questions.values()) {
      if (q.topicId == topicId) { out.add(q) };
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(a.createdAt, b.createdAt));
  };

  func questionsOfChapter(state : State, chapterId : Common.Id) : [Common.Question] {
    let out = List.empty<Common.Question>();
    for (t in state.topics.values()) {
      if (t.chapterId == chapterId) {
        for (q in questionsOfTopic(state, t.id).values()) { out.add(q) };
      };
    };
    out.toArray();
  };

  /// Create (or return the existing) public read-only share link for a
  /// chapter or topic.
  public func createShare(state : State, owner : Principal, target : Common.ShareTarget) : async Result.Result<Common.ShareLink, Common.ShareError> {
    if (not targetOwned(state, owner, target)) { return #err(#notFound) };
    let key = targetKey(target);
    for (s in state.shares.values()) {
      if (s.owner == owner and targetKey(s.target) == key) { return #ok(toLink(s)) };
    };
    let token = await newToken();
    let share : ShareTypes.Share = { token; owner; target; createdAt = Time.now() };
    state.shares.add(token, share);
    #ok(toLink(share));
  };

  /// List the caller's share links.
  public func listShares(state : State, owner : Principal) : [Common.ShareLink] {
    let out = List.empty<Common.ShareLink>();
    for (s in state.shares.values()) {
      if (s.owner == owner) { out.add(toLink(s)) };
    };
    let arr = out.toArray();
    arr.sort(func(a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  /// Revoke a share link; it no longer resolves afterwards.
  public func revokeShare(state : State, owner : Principal, token : Text) : Bool {
    switch (state.shares.get(token)) {
      case (?s) {
        if (s.owner != owner) { return false };
        state.shares.remove(token);
        true;
      };
      case null { false };
    };
  };

  /// Resolve a share token to its public read-only content. Anonymous callers
  /// are allowed; answers are never revealed.
  public func getSharedContent(state : State, token : Text) : ?Common.SharedContent {
    let share = switch (state.shares.get(token)) {
      case (?s) { s };
      case null { return null };
    };
    switch (share.target) {
      case (#topic(topicId)) {
        switch (state.topics.get(topicId)) {
          case (?t) {
            switch (state.chapters.get(t.chapterId)) {
              case (?c) {
                switch (state.subjects.get(c.subjectId)) {
                  case (?s) {
                    switch (state.classes.get(s.classId)) {
                      case (?cl) {
                        ?{
                          title = t.name;
                          breadcrumb = [
                            { id = cl.id; name = cl.name },
                            { id = s.id; name = s.name },
                            { id = c.id; name = c.name },
                            { id = t.id; name = t.name },
                          ];
                          questions = questionsOfTopic(state, topicId).map(publicQuestion);
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
      case (#chapter(chapterId)) {
        switch (state.chapters.get(chapterId)) {
          case (?c) {
            switch (state.subjects.get(c.subjectId)) {
              case (?s) {
                switch (state.classes.get(s.classId)) {
                  case (?cl) {
                    ?{
                      title = c.name;
                      breadcrumb = [
                        { id = cl.id; name = cl.name },
                        { id = s.id; name = s.name },
                        { id = c.id; name = c.name },
                      ];
                      questions = questionsOfChapter(state, chapterId).map(publicQuestion);
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
    };
  };

  // ── Export helpers ────────────────────────────────────────────────────────

  func csvCell(value : Text) : Text {
    "\"" # value.replace(#text "\"", "\"\"") # "\"";
  };

  func answerText(q : Common.Question) : Text {
    switch (q.answer) {
      case (#multipleChoice(mc)) {
        var found = "";
        for (o in mc.options.values()) {
          if (o.id == mc.correctOptionId) { found := o.text };
        };
        found;
      };
      case (#trueFalse(tf)) { if (tf.correct) { "True" } else { "False" } };
      case (#shortAnswer(sa)) { sa.expected };
    };
  };

  func typeText(q : Common.Question) : Text {
    switch (q.questionType) {
      case (#multipleChoice) { "Multiple choice" };
      case (#trueFalse) { "True / false" };
      case (#shortAnswer) { "Short answer" };
    };
  };

  func optionsText(q : Common.Question) : Text {
    switch (q.answer) {
      case (#multipleChoice(mc)) {
        mc.options.values().map(func o = o.text).join(" | ");
      };
      case (_) { "" };
    };
  };

  func csvFor(title : Text, questions : [Common.Question]) : Text {
    let rows = List.empty<Text>();
    rows.add("Topic,Type,Question,Options,Answer,Explanation");
    for (q in questions.values()) {
      rows.add(
        csvCell(title) # ","
        # csvCell(typeText(q)) # ","
        # csvCell(q.prompt) # ","
        # csvCell(optionsText(q)) # ","
        # csvCell(answerText(q)) # ","
        # csvCell(q.explanation ?? "")
      );
    };
    rows.values().join("\n") # "\n";
  };

  func escapePdf(text : Text) : Text {
    text.replace(#text "\\", "\\\\").replace(#text "(", "\\(").replace(#text ")", "\\)");
  };

  func pdfFor(title : Text, questions : [Common.Question]) : Text {
    let lines = List.empty<Text>();
    lines.add(title);
    lines.add("");
    var index = 1;
    for (q in questions.values()) {
      lines.add(index.toText() # ". " # q.prompt);
      lines.add("   Type: " # typeText(q));
      let opts = optionsText(q);
      if (opts != "") { lines.add("   Options: " # opts) };
      lines.add("   Answer: " # answerText(q));
      switch (q.explanation) {
        case (?e) { lines.add("   Explanation: " # e) };
        case null {};
      };
      lines.add("");
      index += 1;
    };

    let content = List.empty<Text>();
    content.add("BT /F1 12 Tf 50 780 Td 16 TL");
    for (line in lines.values()) {
      content.add("(" # escapePdf(line) # ") Tj T*");
    };
    content.add("ET");
    let stream = content.values().join("\n");

    let objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      "<< /Length " # stream.size().toText() # " >>\nstream\n" # stream # "\nendstream",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];

    let out = List.empty<Text>();
    out.add("%PDF-1.4\n");
    let offsets = List.empty<Nat>();
    var offset = "%PDF-1.4\n".size();
    var number = 1;
    for (obj in objects.values()) {
      offsets.add(offset);
      let chunk = number.toText() # " 0 obj\n" # obj # "\nendobj\n";
      out.add(chunk);
      offset += chunk.size();
      number += 1;
    };
    let xrefOffset = offset;
    out.add("xref\n0 " # (objects.size() + 1).toText() # "\n");
    out.add("0000000000 65535 f \n");
    for (o in offsets.values()) {
      let digits = o.toText();
      var padding = "";
      var i = digits.size();
      while (i < 10) { padding := padding # "0"; i += 1 };
      out.add(padding # digits # " 00000 n \n");
    };
    out.add("trailer\n<< /Size " # (objects.size() + 1).toText() # " /Root 1 0 R >>\n");
    out.add("startxref\n" # xrefOffset.toText() # "\n%%EOF\n");
    out.values().join("");
  };

  /// Export a topic or chapter as a downloadable file.
  public func exportContent(state : State, owner : Principal, target : Common.ShareTarget, format : ShareTypes.ExportFormat) : Result.Result<Common.ExportFile, Common.ExportError> {
    let (title, questions) = switch (target) {
      case (#topic(topicId)) {
        switch (ownedTopic(state, owner, topicId)) {
          case (?t) { (t.name, questionsOfTopic(state, topicId)) };
          case null { return #err(#notFound) };
        };
      };
      case (#chapter(chapterId)) {
        switch (ownedChapter(state, owner, chapterId)) {
          case (?c) { (c.name, questionsOfChapter(state, chapterId)) };
          case null { return #err(#notFound) };
        };
      };
    };
    if (questions.size() == 0) { return #err(#empty) };
    switch (format) {
      case (#csv) {
        #ok({
          filename = title # ".csv";
          mimeType = "text/csv";
          content = csvFor(title, questions);
        });
      };
      case (#pdf) {
        #ok({
          filename = title # ".pdf";
          mimeType = "application/pdf";
          content = pdfFor(title, questions);
        });
      };
    };
  };
};
