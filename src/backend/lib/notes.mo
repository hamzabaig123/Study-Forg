import Int "mo:core/Int";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Text "mo:core/Text";
import Time "mo:core/Time";
import NotesTypes "../types/notes";

module {
  public type Id = NotesTypes.Id;
  public type Timestamp = NotesTypes.Timestamp;
  public type Note = NotesTypes.Note;
  public type NoteView = NotesTypes.NoteView;
  public type NoteShare = NotesTypes.NoteShare;
  public type NoteShareLink = NotesTypes.NoteShareLink;
  public type SharedNote = NotesTypes.SharedNote;
  public type UserSettings = NotesTypes.UserSettings;
  public type UserSettingsView = NotesTypes.UserSettingsView;
  public type UserDataExport = NotesTypes.UserDataExport;
  public type NoteError = NotesTypes.NoteError;
  public type NoteShareError = NotesTypes.NoteShareError;
  public type SettingsError = NotesTypes.SettingsError;

  /// The live status string for a note that is not in the trash.
  let statusActive = "active";
  /// The status string for a note that has been soft-deleted.
  let statusTrashed = "trashed";
  /// The status string for an active share token.
  let shareActive = "active";

  /// URL-safe alphabet for share tokens (no padding, no ambiguous separators).
  let tokenAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  /// Number of random characters in a share token.
  let tokenLength = 24;

  func nextId(counters : { var nextId : Id }) : Id {
    let id = counters.nextId;
    counters.nextId := id + 1;
    id;
  };

  /// Generate a long random URL-safe token. Uses the platform CSPRNG so a
  /// token cannot be guessed from another one.
  func newToken() : async Text {
    let alphabet = tokenAlphabet.toArray();
    var token = "";
    var i = 0;
    while (i < tokenLength) {
      let index = await Random.natRange(0, alphabet.size());
      token := token # Text.fromChar(alphabet[index]);
      i += 1;
    };
    token;
  };

  func toView(note : Note) : NoteView {
    {
      id = note.id;
      title = note.title;
      subjectLabel = note.subjectLabel;
      chapterLabel = note.chapterLabel;
      topicLabel = note.topicLabel;
      documentJson = note.documentJson;
      status = note.status;
      revision = note.revision;
      createdAt = note.createdAt;
      updatedAt = note.updatedAt;
      deletedAt = note.deletedAt;
    };
  };

  func toShareLink(share : NoteShare) : NoteShareLink {
    {
      token = share.token;
      noteId = share.noteId;
      status = share.status;
      createdAt = share.createdAt;
    };
  };

  /// The appearance values the settings surface accepts.
  let allowedAppearances : [Text] = ["light", "dark", "frosted"];
  /// The largest daily study target accepted, in questions per day.
  let maxDailyTarget : Nat = 1000;
  /// The largest display name accepted, in characters.
  let maxDisplayNameLength : Nat = 80;
  /// The largest study goal accepted, in characters.
  let maxStudyGoalLength : Nat = 280;

  func toSettingsView(settings : UserSettings) : UserSettingsView {
    {
      displayName = settings.displayName;
      studyGoal = settings.studyGoal;
      dailyTarget = settings.dailyTarget;
      appearance = settings.appearance;
      updatedAt = settings.updatedAt;
    };
  };

  /// Find a note by id and confirm the caller owns it. Returns `#notFound`
  /// when the id is unknown and `#notAuthorized` when it belongs to someone
  /// else, so a caller cannot probe for other users' note ids.
  func findOwned(notes : Map.Map<Id, Note>, owner : Principal, noteId : Id) : { #ok : Note; #err : NoteError } {
    switch (notes.get(noteId)) {
      case null { #err(#notFound) };
      case (?note) {
        if (Principal.equal(note.owner, owner)) { #ok(note) } else { #err(#notAuthorized) };
      };
    };
  };

  /// Replace a stored note in place, preserving its id and creation time.
  func store(notes : Map.Map<Id, Note>, note : Note) {
    notes.add(note.id, note);
  };

  /// Create a note owned by `owner` and return its view.
  public func createNote(
    notes : Map.Map<Id, Note>,
    counters : { var nextId : Id },
    owner : Principal,
    title : Text,
    subjectLabel : ?Text,
    chapterLabel : ?Text,
    topicLabel : ?Text,
    documentJson : Text,
    searchText : Text,
  ) : NoteView {
    let now = Time.now();
    let note : Note = {
      id = nextId(counters);
      owner;
      title;
      subjectLabel;
      chapterLabel;
      topicLabel;
      documentJson;
      searchText;
      status = statusActive;
      revision = 1;
      createdAt = now;
      updatedAt = now;
      deletedAt = null;
    };
    store(notes, note);
    toView(note);
  };

  /// Case-insensitive match of `query` against a note's title and body text.
  func matches(note : Note, needleText : Text) : Bool {
    let needle = needleText.toLower();
    note.title.toLower().contains(#text needle) or note.searchText.toLower().contains(#text needle);
  };

  /// List the owner's live notes, optionally filtered by a search query.
  public func listNotes(
    notes : Map.Map<Id, Note>,
    owner : Principal,
    searchQuery : ?Text,
  ) : [NoteView] {
    let needle = switch (searchQuery) {
      case null { null };
      case (?raw) {
        let trimmed = raw.trim(#predicate(func c = c == ' '));
        if (trimmed.isEmpty()) { null } else { ?trimmed };
      };
    };
    let matched = notes.values().filter(func note = Principal.equal(note.owner, owner) and note.deletedAt == null and (switch (needle) {
      case null { true };
      case (?needleText) { matches(note, needleText) };
    })).map(func note = toView(note)).toArray();
    matched.sort(func (a, b) = Int.compare(b.updatedAt, a.updatedAt));
  };

  /// List the owner's soft-deleted notes.
  public func listTrashedNotes(notes : Map.Map<Id, Note>, owner : Principal) : [NoteView] {
    let matched = notes.values().filter(func note = Principal.equal(note.owner, owner) and note.deletedAt != null).map(func note = toView(note)).toArray();
    matched.sort(func (a, b) = Int.compare(b.updatedAt, a.updatedAt));
  };

  /// Read one note, scoped to its owner.
  public func getNote(notes : Map.Map<Id, Note>, owner : Principal, noteId : Id) : ?NoteView {
    switch (findOwned(notes, owner, noteId)) {
      case (#ok(note)) { ?toView(note) };
      case (#err(_)) { null };
    };
  };

  /// Update a note's content, rejecting a stale `expectedRevision`.
  public func updateNote(
    notes : Map.Map<Id, Note>,
    owner : Principal,
    noteId : Id,
    title : Text,
    subjectLabel : ?Text,
    chapterLabel : ?Text,
    topicLabel : ?Text,
    documentJson : Text,
    searchText : Text,
    expectedRevision : Nat,
  ) : { #ok : NoteView; #err : NoteError } {
    switch (findOwned(notes, owner, noteId)) {
      case (#err(e)) { #err(e) };
      case (#ok(note)) {
        if (note.revision != expectedRevision) {
          #err(#staleRevision({ expected = expectedRevision; actual = note.revision }));
        } else {
          let updated : Note = {
            id = note.id;
            owner = note.owner;
            title;
            subjectLabel;
            chapterLabel;
            topicLabel;
            documentJson;
            searchText;
            status = note.status;
            revision = note.revision + 1;
            createdAt = note.createdAt;
            updatedAt = Time.now();
            deletedAt = note.deletedAt;
          };
          store(notes, updated);
          #ok(toView(updated));
        };
      };
    };
  };

  /// Rename a note, scoped to its owner.
  public func renameNote(
    notes : Map.Map<Id, Note>,
    owner : Principal,
    noteId : Id,
    title : Text,
  ) : { #ok : NoteView; #err : NoteError } {
    switch (findOwned(notes, owner, noteId)) {
      case (#err(e)) { #err(e) };
      case (#ok(note)) {
        let updated : Note = {
          id = note.id;
          owner = note.owner;
          title;
          subjectLabel = note.subjectLabel;
          chapterLabel = note.chapterLabel;
          topicLabel = note.topicLabel;
          documentJson = note.documentJson;
          searchText = note.searchText;
          status = note.status;
          revision = note.revision + 1;
          createdAt = note.createdAt;
          updatedAt = Time.now();
          deletedAt = note.deletedAt;
        };
        store(notes, updated);
        #ok(toView(updated));
      };
    };
  };

  /// Soft-delete a note, scoped to its owner.
  public func softDeleteNote(
    notes : Map.Map<Id, Note>,
    owner : Principal,
    noteId : Id,
  ) : { #ok : NoteView; #err : NoteError } {
    switch (findOwned(notes, owner, noteId)) {
      case (#err(e)) { #err(e) };
      case (#ok(note)) {
        let now = Time.now();
        let updated : Note = {
          id = note.id;
          owner = note.owner;
          title = note.title;
          subjectLabel = note.subjectLabel;
          chapterLabel = note.chapterLabel;
          topicLabel = note.topicLabel;
          documentJson = note.documentJson;
          searchText = note.searchText;
          status = statusTrashed;
          revision = note.revision + 1;
          createdAt = note.createdAt;
          updatedAt = now;
          deletedAt = ?now;
        };
        store(notes, updated);
        #ok(toView(updated));
      };
    };
  };

  /// Restore a soft-deleted note, scoped to its owner.
  public func restoreNote(
    notes : Map.Map<Id, Note>,
    owner : Principal,
    noteId : Id,
  ) : { #ok : NoteView; #err : NoteError } {
    switch (findOwned(notes, owner, noteId)) {
      case (#err(e)) { #err(e) };
      case (#ok(note)) {
        let updated : Note = {
          id = note.id;
          owner = note.owner;
          title = note.title;
          subjectLabel = note.subjectLabel;
          chapterLabel = note.chapterLabel;
          topicLabel = note.topicLabel;
          documentJson = note.documentJson;
          searchText = note.searchText;
          status = statusActive;
          revision = note.revision + 1;
          createdAt = note.createdAt;
          updatedAt = Time.now();
          deletedAt = null;
        };
        store(notes, updated);
        #ok(toView(updated));
      };
    };
  };

  /// Permanently delete a note and every share token pointing at it.
  public func permanentlyDeleteNote(
    notes : Map.Map<Id, Note>,
    noteShares : Map.Map<Text, NoteShare>,
    owner : Principal,
    noteId : Id,
  ) : { #ok : (); #err : NoteError } {
    switch (findOwned(notes, owner, noteId)) {
      case (#err(e)) { #err(e) };
      case (#ok(_)) {
        notes.remove(noteId);
        let doomed = noteShares.values().filter(func share = share.noteId == noteId).map(func share = share.token).toArray();
        for (token in doomed.values()) {
          noteShares.remove(token);
        };
        #ok(());
      };
    };
  };

  /// Create a read-only share token for one of the owner's notes.
  public func createNoteShare(
    notes : Map.Map<Id, Note>,
    noteShares : Map.Map<Text, NoteShare>,
    owner : Principal,
    noteId : Id,
  ) : async { #ok : NoteShareLink; #err : NoteShareError } {
    switch (findOwned(notes, owner, noteId)) {
      case (#err(_)) { #err(#notAuthorized) };
      case (#ok(note)) {
        if (note.deletedAt != null) {
          #err(#notFound);
        } else {
          let token = await newToken();
          let share : NoteShare = {
            token;
            noteId;
            owner;
            status = shareActive;
            createdAt = Time.now();
          };
          noteShares.add(token, share);
          #ok(toShareLink(share));
        };
      };
    };
  };

  /// List the owner's note share tokens.
  public func listNoteShares(
    noteShares : Map.Map<Text, NoteShare>,
    owner : Principal,
  ) : [NoteShareLink] {
    let matched = noteShares.values().filter(func share = Principal.equal(share.owner, owner)).map(func share = toShareLink(share)).toArray();
    matched.sort(func (a, b) = Int.compare(b.createdAt, a.createdAt));
  };

  /// Revoke one of the owner's note share tokens.
  public func revokeNoteShare(
    noteShares : Map.Map<Text, NoteShare>,
    owner : Principal,
    token : Text,
  ) : { #ok : (); #err : NoteShareError } {
    switch (noteShares.get(token)) {
      case null { #err(#notFound) };
      case (?share) {
        if (Principal.equal(share.owner, owner)) {
          noteShares.remove(token);
          #ok(());
        } else {
          #err(#notAuthorized);
        };
      };
    };
  };

  /// Resolve a share token to its public read-only note payload.
  public func getSharedNote(
    notes : Map.Map<Id, Note>,
    noteShares : Map.Map<Text, NoteShare>,
    token : Text,
  ) : ?SharedNote {
    switch (noteShares.get(token)) {
      case null { null };
      case (?share) {
        if (share.status != shareActive) {
          null;
        } else {
          switch (notes.get(share.noteId)) {
            case null { null };
            case (?note) {
              if (note.deletedAt != null) {
                null;
              } else {
                ?{
                  title = note.title;
                  documentJson = note.documentJson;
                  revision = note.revision;
                  updatedAt = note.updatedAt;
                };
              };
            };
          };
        };
      };
    };
  };

  /// Read the signed-in owner's settings, or `null` when never saved.
  public func getMySettings(
    settings : Map.Map<Principal, UserSettings>,
    owner : Principal,
  ) : ?UserSettingsView {
    switch (settings.get(owner)) {
      case null { null };
      case (?saved) { ?toSettingsView(saved) };
    };
  };

  /// Save the signed-in owner's settings. Rejects an empty display name, a
  /// daily target outside `1..maxDailyTarget`, an unknown appearance value, and
  /// over-long text fields with `#invalidInput`.
  public func saveMySettings(
    settings : Map.Map<Principal, UserSettings>,
    owner : Principal,
    displayName : Text,
    studyGoal : Text,
    dailyTarget : Nat,
    appearance : Text,
  ) : { #ok : UserSettingsView; #err : SettingsError } {
    let name = displayName.trim(#predicate(func c = c == ' '));
    if (name.isEmpty()) {
      return #err(#invalidInput("Display name is required"));
    };
    if (name.size() > maxDisplayNameLength) {
      return #err(#invalidInput("Display name must be at most " # maxDisplayNameLength.toText() # " characters"));
    };
    let goal = studyGoal.trim(#predicate(func c = c == ' '));
    if (goal.size() > maxStudyGoalLength) {
      return #err(#invalidInput("Study goal must be at most " # maxStudyGoalLength.toText() # " characters"));
    };
    if (dailyTarget == 0) {
      return #err(#invalidInput("Daily target must be at least 1"));
    };
    if (dailyTarget > maxDailyTarget) {
      return #err(#invalidInput("Daily target must be at most " # maxDailyTarget.toText()));
    };
    let theme = appearance.trim(#predicate(func c = c == ' ')).toLower();
    if (not allowedAppearances.contains(theme)) {
      return #err(#invalidInput("Appearance must be one of: light, dark, frosted"));
    };
    let saved : UserSettings = {
      owner;
      displayName = name;
      studyGoal = goal;
      dailyTarget;
      appearance = theme;
      updatedAt = Time.now();
    };
    settings.add(owner, saved);
    #ok(toSettingsView(saved));
  };

  /// Escape a text value for embedding in a JSON string literal.
  func jsonString(value : Text) : Text {
    var out = "";
    for (c in value.toIter()) {
      switch (c) {
        case ('\"') { out := out # "\\\"" };
        case ('\\') { out := out # "\\\\" };
        case ('\n') { out := out # "\\n" };
        case ('\r') { out := out # "\\r" };
        case ('\t') { out := out # "\\t" };
        case (_) { out := out # Text.fromChar(c) };
      };
    };
    out;
  };

  func jsonField(name : Text, value : Text) : Text {
    "\"" # name # "\":\"" # jsonString(value) # "\"";
  };

  func jsonOptionalField(name : Text, value : ?Text) : Text {
    switch (value) {
      case null { "\"" # name # "\":null" };
      case (?text) { jsonField(name, text) };
    };
  };

  func noteJson(note : Note) : Text {
    "{" # jsonField("id", note.id.toText()) # "," # jsonField("title", note.title) # "," # jsonOptionalField("subjectLabel", note.subjectLabel) # "," # jsonOptionalField("chapterLabel", note.chapterLabel) # "," # jsonOptionalField("topicLabel", note.topicLabel) # "," # jsonField("documentJson", note.documentJson) # "," # jsonField("status", note.status) # "," # jsonField("revision", note.revision.toText()) # "," # jsonField("createdAt", note.createdAt.toText()) # "," # jsonField("updatedAt", note.updatedAt.toText()) # "," # jsonOptionalField("deletedAt", switch (note.deletedAt) {
      case null { null };
      case (?at) { ?at.toText() };
    }) # "}";
  };

  func shareJson(share : NoteShare) : Text {
    "{" # jsonField("token", share.token) # "," # jsonField("noteId", share.noteId.toText()) # "," # jsonField("status", share.status) # "," # jsonField("createdAt", share.createdAt.toText()) # "}";
  };

  func settingsJson(saved : UserSettings) : Text {
    "{" # jsonField("displayName", saved.displayName) # "," # jsonField("studyGoal", saved.studyGoal) # "," # jsonField("dailyTarget", saved.dailyTarget.toText()) # "," # jsonField("appearance", saved.appearance) # "," # jsonField("updatedAt", saved.updatedAt.toText()) # "}";
  };

  /// Build a JSON export of everything the signed-in owner stores.
  public func exportMyData(
    notes : Map.Map<Id, Note>,
    noteShares : Map.Map<Text, NoteShare>,
    settings : Map.Map<Principal, UserSettings>,
    owner : Principal,
  ) : UserDataExport {
    let ownedNotes = notes.values().filter(func note = Principal.equal(note.owner, owner)).map(func note = noteJson(note)).toArray();
    let ownedShares = noteShares.values().filter(func share = Principal.equal(share.owner, owner)).map(func share = shareJson(share)).toArray();
    let settingsPart = switch (settings.get(owner)) {
      case null { "null" };
      case (?saved) { settingsJson(saved) };
    };
    let content = "{" # jsonField("owner", owner.toText()) # ",\"notes\":[" # ownedNotes.values().join(",") # "],\"shares\":[" # ownedShares.values().join(",") # "],\"settings\":" # settingsPart # "}";
    {
      filename = "studydesk-export.json";
      mimeType = "application/json";
      content;
    };
  };
};
