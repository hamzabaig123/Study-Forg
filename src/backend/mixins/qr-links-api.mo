import Map "mo:core/Map";
import List "mo:core/List";
import Time "mo:core/Time";
import Principal "mo:core/Principal";
import Types "../types/qr-links";
import QrLinksLib "../lib/qr-links";

mixin (
  links : Map.Map<Types.LinkId, Types.ShortLink>,
  scans : List.List<Types.ScanRecord>,
  abuseReports : List.List<Types.AbuseReport>,
  counters : { var nextId : Types.LinkId },
) {
  /// Rate-limit windows are transient: they are rebuilt after an upgrade and
  /// are not part of the durable link state.
  transient let createWindows : Map.Map<Text, { var windowStart : Int; var count : Nat }> = Map.empty();
  transient let resolveWindows : Map.Map<Text, { var windowStart : Int; var count : Nat }> = Map.empty();

  /// Window length for creation rate limiting (one minute).
  transient let createWindowNanos : Int = 60_000_000_000;
  /// Maximum link creations allowed per window.
  transient let createLimit : Nat = 10;
  /// Window length for redirect resolution rate limiting (one minute).
  transient let resolveWindowNanos : Int = 60_000_000_000;
  /// Maximum redirect resolutions allowed per window.
  transient let resolveLimit : Nat = 120;

  /// Record one hit against a rate-limit window and report whether the caller
  /// is still within the limit.
  func allow(
    windows : Map.Map<Text, { var windowStart : Int; var count : Nat }>,
    key : Text,
    limit : Nat,
    windowNanos : Int,
  ) : Bool {
    let now = Time.now();
    switch (windows.get(key)) {
      case null {
        windows.add(key, { var windowStart = now; var count = 1 });
        true;
      };
      case (?window) {
        if (now - window.windowStart >= windowNanos) {
          window.windowStart := now;
          window.count := 1;
          true;
        } else if (window.count < limit) {
          window.count += 1;
          true;
        } else {
          false;
        };
      };
    };
  };

  /// Create a short link for a target URL. Anonymous callers are allowed.
  /// Returns the short URL to encode in the QR code and the secret manage URL.
  public shared ({ caller }) func createLink(targetUrl : Text) : async {
    #ok : Types.CreatedLink;
    #err : Types.CreateLinkError;
  } {
    if (not allow(createWindows, caller.toText(), createLimit, createWindowNanos)) {
      return #err(#rateLimited);
    };
    QrLinksLib.createLink(links, counters, targetUrl);
  };

  /// Resolve a short code for redirect. Anonymous callers are allowed.
  /// Returns the current target URL or the reason the link is unavailable.
  public shared ({ caller }) func resolveCode(
    code : Types.ShortCode,
    device : Types.DeviceType,
    country : ?Text,
  ) : async Types.ResolveResult {
    if (not allow(resolveWindows, caller.toText(), resolveLimit, resolveWindowNanos)) {
      return #unavailable(#rateLimited);
    };
    QrLinksLib.resolveCode(links, scans, code, device, country);
  };

  /// Fetch link details by secret edit token. Anonymous, token-gated.
  public query func getLinkByToken(editToken : Types.EditToken) : async ?Types.LinkDetail {
    QrLinksLib.getLinkByToken(links, editToken);
  };

  /// Change the target URL of a link by secret edit token.
  public shared func updateTarget(
    editToken : Types.EditToken,
    targetUrl : Text,
  ) : async { #ok : Types.LinkDetail; #err : Types.ManageLinkError } {
    QrLinksLib.updateTarget(links, editToken, targetUrl);
  };

  /// Pause or unpause a link by secret edit token.
  public shared func setPaused(
    editToken : Types.EditToken,
    paused : Bool,
  ) : async { #ok : Types.LinkDetail; #err : Types.ManageLinkError } {
    QrLinksLib.setPaused(links, editToken, paused);
  };

  /// Soft-delete a link by secret edit token.
  public shared func deleteLink(editToken : Types.EditToken) : async {
    #ok;
    #err : Types.ManageLinkError;
  } {
    QrLinksLib.deleteLink(links, editToken);
  };

  /// Scan statistics for a link by secret edit token.
  public query func getScanStats(editToken : Types.EditToken) : async ?Types.ScanStats {
    QrLinksLib.getScanStats(links, scans, editToken);
  };

  /// Report a short link as abusive.
  public shared func reportAbuse(code : Types.ShortCode, reason : Text) : async {
    #ok;
    #err : Types.AbuseError;
  } {
    QrLinksLib.reportAbuse(links, abuseReports, code, reason);
  };
};
