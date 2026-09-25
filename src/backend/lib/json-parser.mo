import Result "mo:core/Result";
import Int "mo:core/Int";
import Nat "mo:core/Nat";

/// A minimal, tolerant JSON reader for model responses. It parses a JSON
/// document into a `JsonValue` tree and exposes typed field accessors. It is
/// deliberately permissive: unknown fields are ignored and malformed input
/// yields `#err` rather than trapping, so a bad model response becomes a
/// user-facing generation error instead of a canister trap.
module {
  public type JsonValue = {
    #obj : [(Text, JsonValue)];
    #array : [JsonValue];
    #string : Text;
    #number : Float;
    #bool : Bool;
    #nullValue;
  };

  public type ParseError = { #unexpectedEnd; #unexpectedChar : Char };

  type Parser = {
    chars : [Char];
    var pos : Nat;
  };

  func skipWhitespace(p : Parser) {
    let size = p.chars.size();
    var scanning = true;
    while (scanning and p.pos < size) {
      let c = p.chars[p.pos];
      if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
        p.pos += 1;
      } else {
        scanning := false;
      };
    };
  };

  func parseValue(p : Parser) : Result.Result<JsonValue, ParseError> {
    skipWhitespace(p);
    if (p.pos >= p.chars.size()) {
      return #err(#unexpectedEnd);
    };
    let c = p.chars[p.pos];
    if (c == '{') { parseObject(p) } else if (c == '[') { parseArray(p) } else if (c == '\"') {
      switch (parseString(p)) {
        case (#ok s) { #ok(#string(s)) };
        case (#err e) { #err(e) };
      };
    } else if (c == 't' or c == 'f') { parseBool(p) } else if (c == 'n') { parseNull(p) } else {
      parseNumber(p);
    };
  };

  func parseObject(p : Parser) : Result.Result<JsonValue, ParseError> {
    p.pos += 1; // consume '{'
    var entries : [(Text, JsonValue)] = [];
    skipWhitespace(p);
    if (p.pos < p.chars.size() and p.chars[p.pos] == '}') {
      p.pos += 1;
      return #ok(#obj(entries));
    };
    var parsing = true;
    while (parsing) {
      skipWhitespace(p);
      if (p.pos >= p.chars.size() or p.chars[p.pos] != '\"') {
        return #err(#unexpectedChar(if (p.pos < p.chars.size()) { p.chars[p.pos] } else { ' ' }));
      };
      let key = switch (parseString(p)) {
        case (#ok k) { k };
        case (#err e) { return #err(e) };
      };
      skipWhitespace(p);
      if (p.pos >= p.chars.size() or p.chars[p.pos] != ':') {
        return #err(#unexpectedChar(if (p.pos < p.chars.size()) { p.chars[p.pos] } else { ' ' }));
      };
      p.pos += 1; // consume ':'
      let value = switch (parseValue(p)) {
        case (#ok v) { v };
        case (#err e) { return #err(e) };
      };
      entries := entries.concat([(key, value)]);
      skipWhitespace(p);
      if (p.pos >= p.chars.size()) {
        return #err(#unexpectedEnd);
      };
      let next = p.chars[p.pos];
      if (next == ',') {
        p.pos += 1;
      } else if (next == '}') {
        p.pos += 1;
        parsing := false;
      } else {
        return #err(#unexpectedChar(next));
      };
    };
    #ok(#obj(entries));
  };

  func parseArray(p : Parser) : Result.Result<JsonValue, ParseError> {
    p.pos += 1; // consume '['
    var items : [JsonValue] = [];
    skipWhitespace(p);
    if (p.pos < p.chars.size() and p.chars[p.pos] == ']') {
      p.pos += 1;
      return #ok(#array(items));
    };
    var parsing = true;
    while (parsing) {
      let value = switch (parseValue(p)) {
        case (#ok v) { v };
        case (#err e) { return #err(e) };
      };
      items := items.concat([value]);
      skipWhitespace(p);
      if (p.pos >= p.chars.size()) {
        return #err(#unexpectedEnd);
      };
      let next = p.chars[p.pos];
      if (next == ',') {
        p.pos += 1;
      } else if (next == ']') {
        p.pos += 1;
        parsing := false;
      } else {
        return #err(#unexpectedChar(next));
      };
    };
    #ok(#array(items));
  };

  func parseString(p : Parser) : Result.Result<Text, ParseError> {
    p.pos += 1; // consume opening quote
    var buffer : [Char] = [];
    var parsing = true;
    while (parsing) {
      if (p.pos >= p.chars.size()) {
        return #err(#unexpectedEnd);
      };
      let c = p.chars[p.pos];
      if (c == '\"') {
        p.pos += 1;
        parsing := false;
      } else if (c == '\\') {
        p.pos += 1;
        if (p.pos >= p.chars.size()) {
          return #err(#unexpectedEnd);
        };
        let escaped = p.chars[p.pos];
        let decoded = if (escaped == 'n') { '\n' } else if (escaped == 't') { '\t' } else if (escaped == 'r') { '\r' } else if (escaped == 'b') { '\u{08}' } else if (escaped == 'f') { '\u{0C}' } else { escaped };
        buffer := buffer.concat([decoded]);
        p.pos += 1;
      } else {
        buffer := buffer.concat([c]);
        p.pos += 1;
      };
    };
    #ok(buffer.toText());
  };

  func parseBool(p : Parser) : Result.Result<JsonValue, ParseError> {
    if (matches(p, "true")) {
      p.pos += 4;
      #ok(#bool(true));
    } else if (matches(p, "false")) {
      p.pos += 5;
      #ok(#bool(false));
    } else {
      #err(#unexpectedChar(p.chars[p.pos]));
    };
  };

  func parseNull(p : Parser) : Result.Result<JsonValue, ParseError> {
    if (matches(p, "null")) {
      p.pos += 4;
      #ok(#nullValue);
    } else {
      #err(#unexpectedChar(p.chars[p.pos]));
    };
  };

  func matches(p : Parser, word : Text) : Bool {
    let wordChars = word.toArray();
    if (p.pos + wordChars.size() > p.chars.size()) {
      return false;
    };
    var i = 0;
    var ok = true;
    while (i < wordChars.size() and ok) {
      if (p.chars[p.pos + i] != wordChars[i]) { ok := false };
      i += 1;
    };
    ok;
  };

  func parseNumber(p : Parser) : Result.Result<JsonValue, ParseError> {
    let start = p.pos;
    let size = p.chars.size();
    var scanning = true;
    while (scanning and p.pos < size) {
      let c = p.chars[p.pos];
      if ((c >= '0' and c <= '9') or c == '-' or c == '+' or c == '.' or c == 'e' or c == 'E') {
        p.pos += 1;
      } else {
        scanning := false;
      };
    };
    if (p.pos == start) {
      return #err(#unexpectedChar(p.chars[p.pos]));
    };
    let text = p.chars.sliceToArray(start.toInt(), p.pos.toInt()).toText();
    switch (text.toInt()) {
      case (?i) { #ok(#number(i.toFloat())) };
      case null {
        switch (text.toNat()) {
          case (?n) { #ok(#number(n.toFloat())) };
          case null { #err(#unexpectedChar(p.chars[start])) };
        };
      };
    };
  };

  /// Parse a JSON document. Returns `#err` on malformed input.
  public func parse(text : Text) : Result.Result<JsonValue, ParseError> {
    let p : Parser = { chars = text.toArray(); var pos = 0 };
    let value = parseValue(p);
    switch (value) {
      case (#ok v) {
        skipWhitespace(p);
        if (p.pos < p.chars.size()) {
          #err(#unexpectedChar(p.chars[p.pos]));
        } else {
          #ok(v);
        };
      };
      case (#err e) { #err(e) };
    };
  };

  /// Look up a field in an object's entry list.
  public func field(entries : [(Text, JsonValue)], name : Text) : ?JsonValue {
    switch (entries.find(func((key, _)) = key == name)) {
      case (?(_, value)) { ?value };
      case null { null };
    };
  };

  /// Read a string field.
  public func getText(entries : [(Text, JsonValue)], name : Text) : ?Text {
    switch (field(entries, name)) {
      case (?#string(s)) { ?s };
      case _ { null };
    };
  };

  /// Read a boolean field.
  public func getBool(entries : [(Text, JsonValue)], name : Text) : ?Bool {
    switch (field(entries, name)) {
      case (?#bool(b)) { ?b };
      case _ { null };
    };
  };

  /// Read a non-negative integer field.
  public func getNat(entries : [(Text, JsonValue)], name : Text) : ?Nat {
    switch (field(entries, name)) {
      case (?#number(f)) {
        if (f < 0.0) { null } else { ?f.toInt().toNat() };
      };
      case _ { null };
    };
  };

  /// Read an array field as a list of raw JSON values.
  public func getArray(entries : [(Text, JsonValue)], name : Text) : ?[JsonValue] {
    switch (field(entries, name)) {
      case (?#array(items)) { ?items };
      case _ { null };
    };
  };

  /// Read an array field as a list of strings, dropping non-string entries.
  public func getTextArray(entries : [(Text, JsonValue)], name : Text) : [Text] {
    switch (getArray(entries, name)) {
      case (?items) {
        items.filterMap(
          func(item) {
            switch (item) {
              case (#string(s)) { ?s };
              case _ { null };
            };
          }
        );
      };
      case null { [] };
    };
  };
};
