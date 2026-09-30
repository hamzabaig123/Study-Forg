import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import RandomCodes "../lib/random-codes";
import NotesLib "../lib/notes";
import NotesTypes "../types/notes";

mixin (
  notes : Map.Map<NotesTypes.Id, NotesTypes.Note>,
  noteShares : Map.Map<Text, NotesTypes.NoteShare>,
  settings : Map.Map<Principal, NotesTypes.UserSettings>,
  counters : { var nextId : NotesTypes.Id },
  entropy : RandomCodes.Entropy,
) {
  /// Reject anonymous callers. Every note and settings operation is private to
  /// a signed-in identity, so an anonymous principal never reaches the domain
  /// logic.
  func requireSignedIn(caller : Principal) : Bool {
    not caller.isAnonymous();
  };

  /// Create a note owned by the caller.
  public shared ({ caller }) func createNote(
    title : Text,
    subjectLabel : ?Text,
    chapterLabel : ?Text,
    topicLabel : ?Text,
    documentJson : Text,
    searchText : Text,
  ) : async NotesTypes.NoteView {
    if (not requireSignedIn(caller)) {
      Runtime.trap("Sign in to create notes");
    };
    NotesLib.createNote(notes, counters, caller, title, subjectLabel, chapterLabel, topicLabel, documentJson, searchText);
  };

  /// List the caller's live notes, optionally filtered by a search query.
  public query ({ caller }) func listNotes(searchQuery : ?Text) : async [NotesTypes.NoteView] {
    if (not requireSignedIn(caller)) {
      return [];
    };
    NotesLib.listNotes(notes, caller, searchQuery);
  };

  /// List the caller's soft-deleted notes.
  public query ({ caller }) func listTrashedNotes() : async [NotesTypes.NoteView] {
    if (not requireSignedIn(caller)) {
      return [];
    };
    NotesLib.listTrashedNotes(notes, caller);
  };

  /// Read one of the caller's notes.
  public query ({ caller }) func getNote(noteId : NotesTypes.Id) : async ?NotesTypes.NoteView {
    if (not requireSignedIn(caller)) {
      return null;
    };
    NotesLib.getNote(notes, caller, noteId);
  };

  /// Update one of the caller's notes, rejecting a stale `expectedRevision`.
  public shared ({ caller }) func updateNote(
    noteId : NotesTypes.Id,
    title : Text,
    subjectLabel : ?Text,
    chapterLabel : ?Text,
    topicLabel : ?Text,
    documentJson : Text,
    searchText : Text,
    expectedRevision : Nat,
  ) : async { #ok : NotesTypes.NoteView; #err : NotesTypes.NoteError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.updateNote(notes, caller, noteId, title, subjectLabel, chapterLabel, topicLabel, documentJson, searchText, expectedRevision);
  };

  /// Rename one of the caller's notes.
  public shared ({ caller }) func renameNote(
    noteId : NotesTypes.Id,
    title : Text,
  ) : async { #ok : NotesTypes.NoteView; #err : NotesTypes.NoteError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.renameNote(notes, caller, noteId, title);
  };

  /// Soft-delete one of the caller's notes.
  public shared ({ caller }) func softDeleteNote(
    noteId : NotesTypes.Id,
  ) : async { #ok : NotesTypes.NoteView; #err : NotesTypes.NoteError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.softDeleteNote(notes, caller, noteId);
  };

  /// Restore one of the caller's soft-deleted notes.
  public shared ({ caller }) func restoreNote(
    noteId : NotesTypes.Id,
  ) : async { #ok : NotesTypes.NoteView; #err : NotesTypes.NoteError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.restoreNote(notes, caller, noteId);
  };

  /// Permanently delete one of the caller's notes and its share tokens.
  public shared ({ caller }) func permanentlyDeleteNote(
    noteId : NotesTypes.Id,
  ) : async { #ok : (); #err : NotesTypes.NoteError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.permanentlyDeleteNote(notes, noteShares, caller, noteId);
  };

  /// Create a read-only share token for one of the caller's notes.
  public shared ({ caller }) func createNoteShare(
    noteId : NotesTypes.Id,
  ) : async { #ok : NotesTypes.NoteShareLink; #err : NotesTypes.NoteShareError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    await NotesLib.createNoteShare(notes, noteShares, entropy, caller, noteId);
  };

  /// List the caller's note share tokens.
  public query ({ caller }) func listNoteShares() : async [NotesTypes.NoteShareLink] {
    if (not requireSignedIn(caller)) {
      return [];
    };
    NotesLib.listNoteShares(noteShares, caller);
  };

  /// Revoke one of the caller's note share tokens.
  public shared ({ caller }) func revokeNoteShare(
    token : Text,
  ) : async { #ok : (); #err : NotesTypes.NoteShareError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.revokeNoteShare(noteShares, caller, token);
  };

  /// Resolve a share token to its public read-only note payload.
  public query func getSharedNote(token : Text) : async ?NotesTypes.SharedNote {
    NotesLib.getSharedNote(notes, noteShares, token);
  };

  /// Read the caller's settings.
  public query ({ caller }) func getMySettings() : async ?NotesTypes.UserSettingsView {
    if (not requireSignedIn(caller)) {
      return null;
    };
    NotesLib.getMySettings(settings, caller);
  };

  /// Save the caller's settings.
  public shared ({ caller }) func saveMySettings(
    displayName : Text,
    studyGoal : Text,
    dailyTarget : Nat,
    appearance : Text,
  ) : async { #ok : NotesTypes.UserSettingsView; #err : NotesTypes.SettingsError } {
    if (not requireSignedIn(caller)) {
      return #err(#notAuthorized);
    };
    NotesLib.saveMySettings(settings, caller, displayName, studyGoal, dailyTarget, appearance);
  };

  /// Export everything the caller stores as a downloadable JSON file.
  public query ({ caller }) func exportMyData() : async NotesTypes.UserDataExport {
    if (not requireSignedIn(caller)) {
      return { filename = "studydesk-export.json"; mimeType = "application/json"; content = "{}" };
    };
    NotesLib.exportMyData(notes, noteShares, settings, caller);
  };
};
