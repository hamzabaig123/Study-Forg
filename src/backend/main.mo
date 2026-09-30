import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import Expose "mo:caffeineai-oql/Expose";
import OQL "mo:caffeineai-oql";
import Entity "mo:caffeineai-oql/Entity";
import MapEntity "mo:caffeineai-oql/MapEntity";
import NatValue "mo:caffeineai-oql/NatValue";
import IntValue "mo:caffeineai-oql/IntValue";
import TextValue "mo:caffeineai-oql/TextValue";
import BoolValue "mo:caffeineai-oql/BoolValue";
import PrincipalValue "mo:caffeineai-oql/PrincipalValue";
import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";

import Common "types/common";
import ContentTypes "types/content";
import SessionTypes "types/sessions";
import ShareTypes "types/sharing";
import NotesTypes "types/notes";
import QrLinkTypes "types/qr-links";

import ContentApi "mixins/content-api";
import AiApi "mixins/ai-api";
import SessionsApi "mixins/sessions-api";
import AnalyticsApi "mixins/analytics-api";
import SharingApi "mixins/sharing-api";
import NotesApi "mixins/notes-api";
import QrLinksApi "mixins/qr-links-api";
import MaintenanceApi "mixins/maintenance-api";
import ApiDocMixin "mixins/api-doc";
import RandomCodes "lib/random-codes";

actor {
  func questionTypeText(qt : Common.QuestionType) : Text {
    switch (qt) {
      case (#multipleChoice) { "multipleChoice" };
      case (#trueFalse) { "trueFalse" };
      case (#shortAnswer) { "shortAnswer" };
    };
  };

  func sessionModeText(mode : Common.SessionMode) : Text {
    switch (mode) {
      case (#practice) { "practice" };
      case (#timedTest) { "timedTest" };
    };
  };

  func sessionScopeText(scope : Common.SessionScope) : Text {
    switch (scope) {
      case (#topic(id)) { "topic:" # id.toText() };
      case (#chapter(id)) { "chapter:" # id.toText() };
    };
  };

  func shareTargetText(target : Common.ShareTarget) : Text {
    switch (target) {
      case (#topic(id)) { "topic:" # id.toText() };
      case (#chapter(id)) { "chapter:" # id.toText() };
    };
  };

  func linkStatusText(status : QrLinkTypes.LinkStatus) : Text {
    switch (status) {
      case (#active) { "active" };
      case (#paused) { "paused" };
      case (#deleted) { "deleted" };
    };
  };

  func deviceTypeText(device : QrLinkTypes.DeviceType) : Text {
    switch (device) {
      case (#mobile) { "mobile" };
      case (#tablet) { "tablet" };
      case (#desktop) { "desktop" };
      case (#other) { "other" };
    };
  };

  // ── Authorization ────────────────────────────────────────────────────────
  let accessControlState : AccessControl.AccessControlState;

  // ── Content hierarchy ────────────────────────────────────────────────────
  let classes : Map.Map<Common.Id, ContentTypes.Class>;
  let subjects : Map.Map<Common.Id, ContentTypes.Subject>;
  let chapters : Map.Map<Common.Id, ContentTypes.Chapter>;
  let topics : Map.Map<Common.Id, ContentTypes.Topic>;
  let questions : Map.Map<Common.Id, Common.Question>;

  // ── Hot-path indexes (rebuildable via rebuildIndexes) ────────────────────
  // Maintained at the question and link mutation points; every read that used
  // to scan all questions for one topic's rows goes through these instead.
  let questionsByTopic : Map.Map<Common.Id, List.List<Common.Id>>;
  let linksByCode : Map.Map<Text, QrLinkTypes.LinkId>;

  // ── AI Studio ────────────────────────────────────────────────────────────
  let aiKeys : Map.Map<Principal, Text>;
  let drafts : Map.Map<Common.Id, Common.DraftQuestion>;

  // ── Practice & timed tests ───────────────────────────────────────────────
  let sessions : Map.Map<Common.Id, SessionTypes.Session>;
  let sessionResults : Map.Map<Common.Id, Common.SessionResult>;
  let sessionAnswers : Map.Map<Common.Id, Map.Map<Common.Id, Common.SubmittedAnswer>>;

  // ── Sharing & export ─────────────────────────────────────────────────────
  let shares : Map.Map<Text, ShareTypes.Share>;

  // ── Notes workspace ──────────────────────────────────────────────────────
  let notes : Map.Map<NotesTypes.Id, NotesTypes.Note>;
  let noteShares : Map.Map<Text, NotesTypes.NoteShare>;
  let settings : Map.Map<Principal, NotesTypes.UserSettings>;

  // ── QR short links ───────────────────────────────────────────────────────
  let links : Map.Map<QrLinkTypes.LinkId, QrLinkTypes.ShortLink>;
  let scans : List.List<QrLinkTypes.ScanRecord>;
  let abuseReports : List.List<QrLinkTypes.AbuseReport>;
  let linkCounters : { var nextId : QrLinkTypes.LinkId };

  // ── Counters ─────────────────────────────────────────────────────────────
  let counters : { var nextId : Common.Id };

  // Batched CSPRNG for share tokens, short codes, and edit tokens. Transient:
  // the buffer resets on an upgrade and is refilled from the CSPRNG on the
  // next draw, so it never reaches the stable layout.
  transient let tokenEntropy : RandomCodes.Entropy = RandomCodes.newEntropy();

  include MixinAuthorization(accessControlState, null);

  include ContentApi(classes, subjects, chapters, topics, questions, questionsByTopic, counters);
  include AiApi(aiKeys, drafts);
  include SessionsApi(classes, subjects, chapters, topics, questions, questionsByTopic, sessions, sessionResults, sessionAnswers, counters);
  include AnalyticsApi(classes, subjects, chapters, topics, questions, questionsByTopic, sessions, sessionResults);
  include SharingApi(classes, subjects, chapters, topics, questions, questionsByTopic, shares, counters, tokenEntropy);
  include NotesApi(notes, noteShares, settings, counters, tokenEntropy);
  include QrLinksApi(links, linksByCode, scans, abuseReports, linkCounters, tokenEntropy);
  include MaintenanceApi(accessControlState, questions, questionsByTopic, links, linksByCode);
  include ApiDocMixin();

  include Expose({
    entities = [
      classes.toEntityManual("class", "Class", "id")
        .sample({ id = 0; owner = Principal.fromText("aaaaa-aa"); name = ""; description = null; createdAt = 0; updatedAt = 0 })
        .payload("owner", func c = c.owner)
        .payload("name", func c = c.name)
        .payload("description", func c = c.description ?? "")
        .payload("createdAt", func c = c.createdAt)
        .payload("updatedAt", func c = c.updatedAt)
        .controllerOnly()
        .build(),
      subjects.toEntityManual("subject", "Subject", "id")
        .sample({ id = 0; owner = Principal.fromText("aaaaa-aa"); classId = 0; name = ""; description = null; createdAt = 0; updatedAt = 0 })
        .payload("owner", func s = s.owner)
        .payload("classId", func s = s.classId)
        .edge("classId", "class")
        .payload("name", func s = s.name)
        .payload("description", func s = s.description ?? "")
        .payload("createdAt", func s = s.createdAt)
        .payload("updatedAt", func s = s.updatedAt)
        .controllerOnly()
        .build(),
      chapters.toEntityManual("chapter", "Chapter", "id")
        .sample({ id = 0; owner = Principal.fromText("aaaaa-aa"); subjectId = 0; name = ""; description = null; createdAt = 0; updatedAt = 0 })
        .payload("owner", func c = c.owner)
        .payload("subjectId", func c = c.subjectId)
        .edge("subjectId", "subject")
        .payload("name", func c = c.name)
        .payload("description", func c = c.description ?? "")
        .payload("createdAt", func c = c.createdAt)
        .payload("updatedAt", func c = c.updatedAt)
        .controllerOnly()
        .build(),
      topics.toEntityManual("topic", "Topic", "id")
        .sample({ id = 0; owner = Principal.fromText("aaaaa-aa"); chapterId = 0; name = ""; description = null; createdAt = 0; updatedAt = 0 })
        .payload("owner", func t = t.owner)
        .payload("chapterId", func t = t.chapterId)
        .edge("chapterId", "chapter")
        .payload("name", func t = t.name)
        .payload("description", func t = t.description ?? "")
        .payload("createdAt", func t = t.createdAt)
        .payload("updatedAt", func t = t.updatedAt)
        .controllerOnly()
        .build(),
      questions.toEntityManual("question", "Question", "id")
        .sample({ id = 0; topicId = 0; prompt = ""; questionType = #multipleChoice; answer = #trueFalse({ correct = false }); explanation = null; createdAt = 0; updatedAt = 0 })
        .payload("topicId", func q = q.topicId)
        .edge("topicId", "topic")
        .payload("prompt", func q = q.prompt)
        .payload("questionType", func q = questionTypeText(q.questionType))
        .payload("explanation", func q = q.explanation ?? "")
        .payload("createdAt", func q = q.createdAt)
        .payload("updatedAt", func q = q.updatedAt)
        .controllerOnly()
        .build(),
      sessions.toEntityManual("session", "Session", "id")
        .sample({ id = 0; owner = Principal.fromText("aaaaa-aa"); mode = #practice; scope = #topic(0); scopeLabel = ""; questionIds = []; startedAt = 0; durationSeconds = null; expiresAt = null; completed = false })
        .payload("owner", func s = s.owner)
        .payload("mode", func s = sessionModeText(s.mode))
        .payload("scope", func s = sessionScopeText(s.scope))
        .payload("scopeLabel", func s = s.scopeLabel)
        .payload("questionCount", func s = s.questionIds.size())
        .payload("startedAt", func s = s.startedAt)
        .payload("durationSeconds", func s = s.durationSeconds ?? 0)
        .payload("expiresAt", func s = s.expiresAt ?? 0)
        .payload("completed", func s = s.completed)
        .controllerOnly()
        .build(),
      sessionResults.toEntityManual("sessionResult", "SessionResult", "id")
        .sample({ id = 0; mode = #practice; scope = #topic(0); score = 0; total = 0; startedAt = 0; completedAt = 0; results = [] })
        .payload("mode", func r = sessionModeText(r.mode))
        .payload("scope", func r = sessionScopeText(r.scope))
        .payload("score", func r = r.score)
        .payload("total", func r = r.total)
        .payload("startedAt", func r = r.startedAt)
        .payload("completedAt", func r = r.completedAt)
        .controllerOnly()
        .build(),
      shares.toEntityManual("share", "Share", "token")
        .sample({ token = ""; owner = Principal.fromText("aaaaa-aa"); target = #topic(0); createdAt = 0 })
        .payload("owner", func s = s.owner)
        .payload("target", func s = shareTargetText(s.target))
        .payload("createdAt", func s = s.createdAt)
        .controllerOnly()
        .build(),
      notes.toEntityManual("note", "Note", "id")
        .sample({ id = 0; owner = Principal.fromText("aaaaa-aa"); title = ""; subjectLabel = null; chapterLabel = null; topicLabel = null; documentJson = ""; searchText = ""; status = ""; revision = 0; createdAt = 0; updatedAt = 0; deletedAt = null })
        .payload("owner", func n = n.owner)
        .payload("title", func n = n.title)
        .payload("subjectLabel", func n = n.subjectLabel ?? "")
        .payload("chapterLabel", func n = n.chapterLabel ?? "")
        .payload("topicLabel", func n = n.topicLabel ?? "")
        .payload("status", func n = n.status)
        .payload("revision", func n = n.revision)
        .payload("createdAt", func n = n.createdAt)
        .payload("updatedAt", func n = n.updatedAt)
        .payload("deletedAt", func n = n.deletedAt ?? 0)
        .controllerOnly()
        .build(),
      noteShares.toEntityManual("noteShare", "NoteShare", "token")
        .sample({ token = ""; noteId = 0; owner = Principal.fromText("aaaaa-aa"); status = ""; createdAt = 0 })
        .payload("noteId", func s = s.noteId)
        .edge("noteId", "note")
        .payload("owner", func s = s.owner)
        .payload("status", func s = s.status)
        .payload("createdAt", func s = s.createdAt)
        .controllerOnly()
        .build(),
      settings.toEntityManual("userSettings", "UserSettings", "owner")
        .sample({ owner = Principal.fromText("aaaaa-aa"); displayName = ""; studyGoal = ""; dailyTarget = 0; appearance = ""; updatedAt = 0 })
        .payload("displayName", func s = s.displayName)
        .payload("studyGoal", func s = s.studyGoal)
        .payload("dailyTarget", func s = s.dailyTarget)
        .payload("appearance", func s = s.appearance)
        .payload("updatedAt", func s = s.updatedAt)
        .controllerOnly()
        .build(),
      links.toEntityManual("shortLink", "ShortLink", "id")
        .sample({ id = 0; code = ""; targetUrl = ""; editToken = ""; status = #active; createdAt = 0; updatedAt = 0 })
        .payload("code", func l = l.code)
        .payload("targetUrl", func l = l.targetUrl)
        .payload("status", func l = linkStatusText(l.status))
        .payload("createdAt", func l = l.createdAt)
        .payload("updatedAt", func l = l.updatedAt)
        .controllerOnly()
        .build(),
      OQL.Entity.manual<QrLinkTypes.ScanRecord>("scan", func () = scans.values(), "ScanRecord", "linkId")
        .sample({ linkId = 0; scannedAt = 0; device = #other; country = null })
        .payload("linkId", func s = s.linkId)
        .edge("linkId", "shortLink")
        .payload("scannedAt", func s = s.scannedAt)
        .payload("device", func s = deviceTypeText(s.device))
        .payload("country", func s = s.country ?? "")
        .controllerOnly()
        .build(),
      OQL.Entity.manual<QrLinkTypes.AbuseReport>("abuseReport", func () = abuseReports.values(), "AbuseReport", "code")
        .sample({ code = ""; reason = ""; reportedAt = 0 })
        .payload("code", func r = r.code)
        .payload("reason", func r = r.reason)
        .payload("reportedAt", func r = r.reportedAt)
        .controllerOnly()
        .build(),
    ];
  });
};
