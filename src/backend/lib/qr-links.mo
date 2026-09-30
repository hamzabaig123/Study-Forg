import Map "mo:core/Map";
import List "mo:core/List";
import Int "mo:core/Int";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import RandomCodes "random-codes";
import Types "../types/qr-links";

module {
  /// URL-safe alphabet for short codes and edit tokens. Lowercase
  /// alphanumerics only, so codes are unambiguous in print and in URLs.
  let codeAlphabetText : Text = "abcdefghijklmnopqrstuvwxyz0123456789";

  /// Length of a generated short code. Ten characters of this alphabet is
  /// ~50 bits, matching `lib/supabase/tokens.ts` and the widened `link.code`
  /// CHECK in `supabase/migrations/0003_short_code_entropy.sql`: the public
  /// resolve path has no session in front of it, so the code is the only thing
  /// standing between an anonymous caller and another user's target URL.
  let codeLength : Nat = 10;

  /// Length of a generated secret edit token.
  let tokenLength : Nat = 32;

  /// The scan log is capped so anonymous traffic cannot grow the canister's
  /// memory without bound. When the log passes the cap by the hysteresis
  /// margin, the oldest records are dropped and only the newest `cap` remain;
  /// the margin amortizes the rebuild to O(1) per scan.
  let maxScanRecords : Nat = 20_000;
  let scanPruneHysteresis : Nat = 1_000;

  /// The abuse-report log is capped for the same reason: `reportAbuse` is an
  /// anonymous endpoint and a report nobody reads still occupies memory.
  let maxAbuseReports : Nat = 5_000;
  let reportPruneHysteresis : Nat = 250;

  /// The path prefix the app serves short links under. A target pointing back
  /// at this prefix would create a redirect loop.
  let shortPathPrefix : Text = "/r/";

  /// True when `c` is whitespace that should be trimmed from a URL.
  func isWhitespace(c : Char) : Bool {
    c == ' ' or c == '\t' or c == '\n' or c == '\r';
  };

  /// Trim leading and trailing whitespace from a URL.
  func trimWhitespace(text : Text) : Text {
    let chars = text.toArray();
    let size = chars.size();
    var start = 0;
    while (start < size and isWhitespace(chars[start])) { start += 1 };
    // Find the index just past the last non-whitespace character.
    var end = start;
    var i = start;
    while (i < size) {
      if (not isWhitespace(chars[i])) { end := i + 1 };
      i += 1;
    };
    if (start == 0 and end == size) { return text };
    var out = "";
    var j = start;
    while (j < end) {
      out := out # chars[j].toText();
      j += 1;
    };
    out;
  };

  /// Build a random string of `length` characters from the short-code
  /// alphabet. Uses the platform CSPRNG so codes and secret edit tokens
  /// cannot be guessed from previously issued ones; uniqueness is still
  /// enforced against existing links.
  func randomString(entropy : RandomCodes.Entropy, length : Nat) : async Text {
    await RandomCodes.randomText(entropy, codeAlphabetText, length);
  };

  /// True when `code` is already used by a stored link.
  func codeExists(links : Map.Map<Types.LinkId, Types.ShortLink>, code : Text) : Bool {
    var found = false;
    for ((_, link) in links.entries()) {
      if (link.code == code) { found := true };
    };
    found;
  };

  /// Generate a short code that is unique against the stored links.
  func generateCode(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    entropy : RandomCodes.Entropy,
  ) : async Types.ShortCode {
    var candidate = await randomString(entropy, codeLength);
    var attempts = 0;
    while (codeExists(links, candidate) and attempts < 100) {
      candidate := await randomString(entropy, codeLength);
      attempts += 1;
    };
    candidate;
  };

  /// Generate a fresh secret edit token.
  func generateEditToken(entropy : RandomCodes.Entropy) : async Types.EditToken {
    await randomString(entropy, tokenLength);
  };

  /// Split a URL into its scheme and the remainder after `://`. Returns null
  /// when the URL has no scheme separator.
  func splitScheme(url : Text) : ?(Text, Text) {
    let marker = "://";
    let parts = url.split(#text marker).toArray();
    if (parts.size() < 2) { return null };
    let scheme = parts[0].toLower();
    // Rebuild the remainder from every part after the first, re-joining with
    // the marker so a URL containing "://" later in its path is preserved.
    var remainder = "";
    var i = 1;
    while (i < parts.size()) {
      if (i > 1) { remainder := remainder # marker };
      remainder := remainder # parts[i];
      i += 1;
    };
    ?(scheme, remainder);
  };

  /// True when `host` is an IPv4 literal in a private, loopback, or
  /// link-local range. Called only for hosts that are not IPv6 literals, so
  /// the octet shape check is the gate.
  func isPrivateIpv4(h : Text) : Bool {
    let octets = h.split(#text ".").toArray();
    if (octets.size() != 4) { return false };
    switch (octets[0].toNat()) {
      case (?first) {
        if (first == 10) { return true };
        if (first == 127) { return true };
        if (first == 169) {
          switch (octets[1].toNat()) {
            case (?second) { if (second == 254) { return true } };
            case null {};
          };
        };
        if (first == 192) {
          switch (octets[1].toNat()) {
            case (?second) { if (second == 168) { return true } };
            case null {};
          };
        };
        if (first == 172) {
          switch (octets[1].toNat()) {
            case (?second) {
              if (second >= 16 and second <= 31) { return true };
            };
            case null {};
          };
        };
      };
      case null {};
    };
    false;
  };

  /// True when `host` is a private, loopback, or link-local address literal.
  ///
  /// The checks apply to address literals only, never to hostnames: a domain
  /// that happens to start with "fc" (fcbarcelona.com) is an ordinary public
  /// host, and refusing it on a text prefix was a false positive in the
  /// first version of this rule. IPv6 ranges are gated on the host actually
  /// being an IPv6 literal (it contains `:`), IPv4 ranges on the four-octet
  /// shape.
  func isPrivateHost(host : Text) : Bool {
    // A bracketed IPv6 literal arrives with its brackets (hostOf preserves
    // them so the port split cannot eat the address); strip them so the
    // checks below see the bare address.
    let chars = host.toArray();
    let h = if (chars.size() >= 2 and chars[0] == '[' and chars[chars.size() - 1] == ']') {
      Text.fromArray(chars.sliceToArray(1, chars.size().toInt() - 1)).toLower();
    } else {
      host.toLower();
    };
    // IPv6 literal: loopback (::1), unique-local fc00::/7, link-local
    // fe80::/10 (fe80 through febf), and the dotted form of IPv4-mapped
    // ::ffff:0:0/96.
    if (h.contains(#text ":")) {
      if (h == "::1") { return true };
      if (h.startsWith(#text "fc") or h.startsWith(#text "fd")) { return true };
      for (prefix in ["fe8", "fe9", "fea", "feb"].values()) {
        if (h.startsWith(#text prefix)) { return true };
      };
      let mappedPrefix = "::ffff:";
      let hChars = h.toArray();
      if (h.startsWith(#text mappedPrefix) and hChars.size() > mappedPrefix.size()) {
        if (isPrivateIpv4(Text.fromArray(hChars.sliceToArray(mappedPrefix.size(), hChars.size())))) {
          return true;
        };
      };
      return false;
    };
    isPrivateIpv4(h);
  };

  /// Extract the host portion of a URL remainder (everything after `://`),
  /// dropping any userinfo, port, path, query, and fragment.
  func hostOf(remainder : Text) : Text {
    var host = remainder;
    // Drop path / query / fragment.
    host := host.split(#text "/").toArray()[0];
    host := host.split(#text "?").toArray()[0];
    host := host.split(#text "#").toArray()[0];
    // Drop userinfo: keep everything after the last `@`.
    let at = host.split(#text "@").toArray();
    var last = at[0];
    for (part in at.values()) { last := part };
    host := last;
    // Drop port (but keep IPv6 brackets intact).
    if (host.startsWith(#text "[")) {
      host := host.split(#text "]").toArray()[0] # "]";
    } else {
      host := host.split(#text ":").toArray()[0];
    };
    host;
  };

  /// Extract the path portion of a URL remainder, including the leading slash
  /// and excluding query and fragment.
  func pathOf(remainder : Text) : Text {
    let slashParts = remainder.split(#text "/").toArray();
    if (slashParts.size() < 2) { return "" };
    var path = "/";
    var i = 1;
    while (i < slashParts.size()) {
      let segment = slashParts[i];
      // Stop at a query or fragment marker.
      if (segment.startsWith(#text "?") or segment.startsWith(#text "#")) {
        i := slashParts.size();
      } else {
        path := path # segment;
        if (i + 1 < slashParts.size()) { path := path # "/" };
        i += 1;
      };
    };
    path;
  };

  /// Validate a target URL against the abuse rules: only `http`/`https`
  /// schemes, no private/loopback/link-local hosts, and no target pointing
  /// back at the app's own short-link path.
  public func validateTargetUrl(url : Text) : { #ok; #err : Text } {
    let trimmed = trimWhitespace(url);
    if (trimmed.size() == 0) {
      return #err("Enter a URL to shorten.");
    };
    switch (splitScheme(trimmed)) {
      case null {
        #err("URL must start with http:// or https://");
      };
      case (?(scheme, remainder)) {
        if (scheme != "http" and scheme != "https") {
          return #err("Only http and https links are allowed.");
        };
        if (remainder.size() == 0) {
          return #err("URL is missing a host.");
        };
        let host = hostOf(remainder);
        if (host.size() == 0) {
          return #err("URL is missing a host.");
        };
        if (isPrivateHost(host)) {
          return #err("Links to private or local addresses are not allowed.");
        };
        let path = pathOf(remainder);
        if (path.startsWith(#text shortPathPrefix)) {
          return #err("Links cannot point back at this app's short links.");
        };
        #ok;
      };
    };
  };

  /// Create a short link for a validated target URL. Returns the short URL to
  /// encode in the QR code and the secret manage URL. Anonymous callers are
  /// allowed; creation is rate limited.
  public func createLink(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    counters : { var nextId : Types.LinkId },
    entropy : RandomCodes.Entropy,
    targetUrl : Text,
  ) : async { #ok : Types.CreatedLink; #err : Types.CreateLinkError } {
    switch (validateTargetUrl(targetUrl)) {
      case (#err(message)) { return #err(#invalidUrl(message)) };
      case (#ok) {};
    };
    let now = Time.now();
    let id = counters.nextId;
    counters.nextId := id + 1;
    let code = await generateCode(links, entropy);
    let editToken = await generateEditToken(entropy);
    let normalized = trimWhitespace(targetUrl);
    let link : Types.ShortLink = {
      id;
      code;
      targetUrl = normalized;
      editToken;
      status = #active;
      createdAt = now;
      updatedAt = now;
    };
    links.add(id, link);
    #ok({
      id;
      code;
      shortUrl = "/r/" # code;
      manageUrl = "/manage/" # editToken;
      editToken;
      targetUrl = normalized;
      status = #active;
      createdAt = now;
    });
  };

  /// Keep the newest `cap` records of an append-only log. Called after each
  /// add; the hysteresis margin means the O(n) rebuild happens at most once
  /// per `hysteresis` records.
  func pruneLog<T>(records : List.List<T>, cap : Nat, hysteresis : Nat) {
    let size = records.size();
    if (size > cap + hysteresis) {
      let keep = records.sliceToArray(size.toInt() - cap.toInt(), size.toInt());
      records.clear();
      for (record in keep.values()) { records.add(record) };
    };
  };

  /// Resolve a short code for redirect. Records the scan (time, device,
  /// country only — never a raw IP) without blocking the redirect. Anonymous
  /// callers are allowed; resolution is rate limited.
  public func resolveCode(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    scans : List.List<Types.ScanRecord>,
    code : Types.ShortCode,
    device : Types.DeviceType,
    country : ?Text,
  ) : Types.ResolveResult {
    var found : ?Types.ShortLink = null;
    for ((_, link) in links.entries()) {
      if (link.code == code) { found := ?link };
    };
    switch (found) {
      case null { #unavailable(#notFound) };
      case (?link) {
        switch (link.status) {
          case (#active) {
            scans.add({
              linkId = link.id;
              scannedAt = Time.now();
              device;
              country;
            });
            pruneLog(scans, maxScanRecords, scanPruneHysteresis);
            #redirect({ targetUrl = link.targetUrl });
          };
          case (#paused) { #unavailable(#paused) };
          case (#deleted) { #unavailable(#deleted) };
        };
      };
    };
  };

  /// Find a link by its secret edit token.
  func findByToken(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    editToken : Types.EditToken,
  ) : ?Types.ShortLink {
    var found : ?Types.ShortLink = null;
    for ((_, link) in links.entries()) {
      if (link.editToken == editToken) { found := ?link };
    };
    found;
  };

  /// Project a stored link to its manager-facing detail view.
  func toDetail(link : Types.ShortLink) : Types.LinkDetail {
    {
      id = link.id;
      code = link.code;
      shortUrl = "/r/" # link.code;
      targetUrl = link.targetUrl;
      status = link.status;
      createdAt = link.createdAt;
      updatedAt = link.updatedAt;
    };
  };

  /// Fetch link details by secret edit token. Anonymous, token-gated.
  public func getLinkByToken(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    editToken : Types.EditToken,
  ) : ?Types.LinkDetail {
    switch (findByToken(links, editToken)) {
      case null { null };
      case (?link) { ?toDetail(link) };
    };
  };

  /// Change the target URL of a link by secret edit token.
  public func updateTarget(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    editToken : Types.EditToken,
    targetUrl : Text,
  ) : { #ok : Types.LinkDetail; #err : Types.ManageLinkError } {
    switch (findByToken(links, editToken)) {
      case null { #err(#notFound) };
      case (?link) {
        switch (validateTargetUrl(targetUrl)) {
          case (#err(message)) { #err(#invalidUrl(message)) };
          case (#ok) {
            let updated : Types.ShortLink = {
              id = link.id;
              code = link.code;
              targetUrl = trimWhitespace(targetUrl);
              editToken = link.editToken;
              status = link.status;
              createdAt = link.createdAt;
              updatedAt = Time.now();
            };
            links.add(link.id, updated);
            #ok(toDetail(updated));
          };
        };
      };
    };
  };

  /// Pause or unpause a link by secret edit token.
  public func setPaused(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    editToken : Types.EditToken,
    paused : Bool,
  ) : { #ok : Types.LinkDetail; #err : Types.ManageLinkError } {
    switch (findByToken(links, editToken)) {
      case null { #err(#notFound) };
      case (?link) {
        let updated : Types.ShortLink = {
          id = link.id;
          code = link.code;
          targetUrl = link.targetUrl;
          editToken = link.editToken;
          status = if (paused) { #paused } else { #active };
          createdAt = link.createdAt;
          updatedAt = Time.now();
        };
        links.add(link.id, updated);
        #ok(toDetail(updated));
      };
    };
  };

  /// Soft-delete a link by secret edit token. A deleted link no longer
  /// redirects.
  public func deleteLink(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    editToken : Types.EditToken,
  ) : { #ok; #err : Types.ManageLinkError } {
    switch (findByToken(links, editToken)) {
      case null { #err(#notFound) };
      case (?link) {
        let updated : Types.ShortLink = {
          id = link.id;
          code = link.code;
          targetUrl = link.targetUrl;
          editToken = link.editToken;
          status = #deleted;
          createdAt = link.createdAt;
          updatedAt = Time.now();
        };
        links.add(link.id, updated);
        #ok;
      };
    };
  };

  /// Left-pad a Nat to `width` digits with zeros.
  func pad(value : Nat, width : Nat) : Text {
    var text = value.toText();
    while (text.size() < width) { text := "0" # text };
    text;
  };

  /// Format a nanosecond timestamp as a UTC `YYYY-MM-DD` day key.
  func dayKey(timestamp : Types.Timestamp) : Text {
    let seconds = timestamp / 1_000_000_000;
    let days = seconds / 86_400;
    // Civil-from-days (Howard Hinnant's algorithm), in Int so no subtraction
    // can trap.
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if (mp < 10) { mp + 3 } else { mp - 9 };
    let year = if (m <= 2) { y + 1 } else { y };
    pad(year.toNat(), 4) # "-" # pad(m.toNat(), 2) # "-" # pad(d.toNat(), 2);
  };

  /// Compare two day keys lexicographically (ISO dates sort chronologically).
  func dayBefore(a : Types.DailyScanCount, b : Types.DailyScanCount) : Bool {
    a.day < b.day;
  };

  /// Sort day counts ascending by day key with a small insertion sort, so the
  /// series needs no implicit comparator for the record type.
  func sortDays(days : [Types.DailyScanCount]) : [Types.DailyScanCount] {
    let sorted = days.toVarArray<Types.DailyScanCount>();
    var i = 1;
    while (i < sorted.size()) {
      let current = sorted[i];
      var j = i;
      var placed = false;
      while (not placed) {
        if (j == 0) {
          placed := true;
        } else {
          let previous = sorted[j - 1];
          if (dayBefore(current, previous)) {
            sorted[j] := previous;
            j -= 1;
          } else {
            placed := true;
          };
        };
      };
      sorted[j] := current;
      i += 1;
    };
    sorted.toArray();
  };

  /// Scan statistics for a link by secret edit token: total count plus the
  /// scans-per-day series.
  public func getScanStats(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    scans : List.List<Types.ScanRecord>,
    editToken : Types.EditToken,
  ) : ?Types.ScanStats {
    switch (findByToken(links, editToken)) {
      case null { null };
      case (?link) {
        var total = 0;
        let perDay = Map.empty<Text, Nat>();
        for (scan in scans.values()) {
          if (scan.linkId == link.id) {
            total += 1;
            let key = dayKey(scan.scannedAt);
            let current = perDay.get(key) ?? 0;
            perDay.add(key, current + 1);
          };
        };
        let days = perDay.entries().map(func((day, count)) = { day; count }).toArray();
        ?{ totalScans = total; perDay = sortDays(days) };
      };
    };
  };

  /// Record an abuse report for a short code.
  ///
  /// A code that was never issued answers `#ok` too, and writes nothing —
  /// the same same-answer-either-way rule `supabase/migrations/
  /// 0013_abuse_report_throttle_and_oracle.sql` applies to the Postgres path.
  /// Distinguishing them turned this anonymous endpoint into a free
  /// "which short codes exist?" oracle. The `#notFound` variant stays in the
  /// result type because the candid interface is fixed, not because it is
  /// ever produced.
  public func reportAbuse(
    links : Map.Map<Types.LinkId, Types.ShortLink>,
    reports : List.List<Types.AbuseReport>,
    code : Types.ShortCode,
    reason : Text,
  ) : { #ok; #err : Types.AbuseError } {
    if (code.size() == 0) {
      return #err(#invalidInput("A short code is required."));
    };
    let trimmedReason = trimWhitespace(reason);
    if (trimmedReason.size() == 0) {
      return #err(#invalidInput("Describe the problem with this link."));
    };
    if (not codeExists(links, code)) {
      return #ok;
    };
    reports.add({
      code;
      reason = trimmedReason;
      reportedAt = Time.now();
    });
    pruneLog(reports, maxAbuseReports, reportPruneHysteresis);
    #ok;
  };
};
