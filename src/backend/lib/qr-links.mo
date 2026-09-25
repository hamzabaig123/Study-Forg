import Map "mo:core/Map";
import List "mo:core/List";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import Types "../types/qr-links";

module {
  /// URL-safe alphabet for short codes and edit tokens. Lowercase
  /// alphanumerics only, so codes are unambiguous in print and in URLs.
  let codeAlphabet : [Char] = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ];

  /// Length of a generated short code.
  let codeLength : Nat = 7;

  /// Length of a generated secret edit token.
  let tokenLength : Nat = 32;

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

  /// A tiny deterministic PRNG so code and token generation need no external
  /// entropy source. Seeded from the clock plus a caller-supplied counter, which
  /// is enough to make collisions vanishingly unlikely for a draft app;
  /// uniqueness is still enforced against existing links.
  func nextRandom(state : { var seed : Nat }) : Nat {
    var x = state.seed;
    if (x == 0) { x := 0x9E3779B97F4A7C15 };
    x := (x * 6364136223846793005 + 1442695040888963407) % 18446744073709551557;
    state.seed := x;
    x;
  };

  /// Build a random string of `length` characters from `codeAlphabet`.
  func randomString(state : { var seed : Nat }, length : Nat) : Text {
    var out = "";
    var i = 0;
    while (i < length) {
      let r = nextRandom(state);
      let idx = r % codeAlphabet.size();
      out := out # codeAlphabet[idx].toText();
      i += 1;
    };
    out;
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
    state : { var seed : Nat },
  ) : Types.ShortCode {
    var candidate = randomString(state, codeLength);
    var attempts = 0;
    while (codeExists(links, candidate) and attempts < 100) {
      candidate := randomString(state, codeLength);
      attempts += 1;
    };
    candidate;
  };

  /// Generate a fresh secret edit token.
  func generateEditToken(state : { var seed : Nat }) : Types.EditToken {
    randomString(state, tokenLength);
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

  /// True when `host` is a private, loopback, or link-local address literal.
  func isPrivateHost(host : Text) : Bool {
    let h = host.toLower();
    // IPv6 loopback and unique-local / link-local ranges.
    if (h == "::1" or h == "[::1]") { return true };
    if (h.startsWith(#text "fc") or h.startsWith(#text "fd")) { return true };
    if (h.startsWith(#text "fe80")) { return true };
    // IPv4 literal ranges.
    let octets = h.split(#text ".").toArray();
    if (octets.size() == 4) {
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
    };
    false;
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
    targetUrl : Text,
  ) : { #ok : Types.CreatedLink; #err : Types.CreateLinkError } {
    switch (validateTargetUrl(targetUrl)) {
      case (#err(message)) { return #err(#invalidUrl(message)) };
      case (#ok) {};
    };
    let now = Time.now();
    let id = counters.nextId;
    counters.nextId := id + 1;
    let seed = { var seed = now.toNat() + id + 1 };
    let code = generateCode(links, seed);
    let editToken = generateEditToken(seed);
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
      return #err(#notFound);
    };
    reports.add({
      code;
      reason = trimmedReason;
      reportedAt = Time.now();
    });
    #ok;
  };
};
