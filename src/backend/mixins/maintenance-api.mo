import Map "mo:core/Map";
import List "mo:core/List";
import AccessControl "mo:caffeineai-authorization/access-control";
import Common "../types/common";
import ContentLib "../lib/content";
import QrLinkTypes "../types/qr-links";

mixin (
  accessControlState : AccessControl.AccessControlState,
  questions : Map.Map<Common.Id, Common.Question>,
  questionsByTopic : Map.Map<Common.Id, List.List<Common.Id>>,
  links : Map.Map<QrLinkTypes.LinkId, QrLinkTypes.ShortLink>,
  linksByCode : Map.Map<Text, QrLinkTypes.LinkId>,
) {
  /// Recompute both hot-path indexes from the primary maps.
  ///
  /// The indexes are maintained by the ordinary mutation points (questions in
  /// createQuestion/deleteQuestion/deleteQuestionsOfTopic, link codes in
  /// createLink), so this only ever needs to run once — after an upgrade that
  /// introduces an index onto a state that predates it. Admin-gated because
  /// a full rebuild is the one O(n) operation the indexes exist to avoid.
  public shared ({ caller }) func rebuildIndexes() : async () {
    if (not AccessControl.isAdmin(accessControlState, caller)) {
      return;
    };
    questionsByTopic.clear();
    for ((id, q) in questions.entries()) {
      ContentLib.indexQuestion(questionsByTopic, q.topicId, id);
    };
    linksByCode.clear();
    for ((id, link) in links.entries()) {
      linksByCode.add(link.code, id);
    };
  };
};
