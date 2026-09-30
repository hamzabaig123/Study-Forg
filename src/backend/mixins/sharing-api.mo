import Map "mo:core/Map";
import List "mo:core/List";
import Result "mo:core/Result";
import RandomCodes "../lib/random-codes";
import Common "../types/common";
import ContentTypes "../types/content";
import ShareTypes "../types/sharing";
import SharingLib "../lib/sharing";

mixin (
  classes : Map.Map<Common.Id, ContentTypes.Class>,
  subjects : Map.Map<Common.Id, ContentTypes.Subject>,
  chapters : Map.Map<Common.Id, ContentTypes.Chapter>,
  topics : Map.Map<Common.Id, ContentTypes.Topic>,
  questions : Map.Map<Common.Id, Common.Question>,
  questionsByTopic : Map.Map<Common.Id, List.List<Common.Id>>,
  shares : Map.Map<Text, ShareTypes.Share>,
  counters : { var nextId : Common.Id },
  entropy : RandomCodes.Entropy,
) {
  transient let sharingState : SharingLib.State = { classes; subjects; chapters; topics; questions; questionsByTopic; shares; counters; entropy };

  /// Create (or return the existing) public read-only share link for a
  /// chapter or topic.
  public shared ({ caller }) func createShare(target : Common.ShareTarget) : async Result.Result<Common.ShareLink, Common.ShareError> {
    await SharingLib.createShare(sharingState, caller, target);
  };

  /// List the caller's share links.
  public shared ({ caller }) func listShares() : async [Common.ShareLink] {
    SharingLib.listShares(sharingState, caller);
  };

  /// Revoke a share link; it no longer resolves afterwards.
  public shared ({ caller }) func revokeShare(token : Text) : async Bool {
    SharingLib.revokeShare(sharingState, caller, token);
  };

  /// Resolve a share token to its public read-only content. Anonymous callers
  /// are allowed; answers are never revealed.
  public shared query func getSharedContent(token : Text) : async ?Common.SharedContent {
    SharingLib.getSharedContent(sharingState, token);
  };

  /// Export a topic or chapter as a downloadable file.
  public shared ({ caller }) func exportContent(target : Common.ShareTarget, format : ShareTypes.ExportFormat) : async Result.Result<Common.ExportFile, Common.ExportError> {
    SharingLib.exportContent(sharingState, caller, target, format);
  };
};
