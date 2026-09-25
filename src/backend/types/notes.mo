import Common "../types/common";

module {
  public type Id = Common.Id;
  public type Timestamp = Common.Timestamp;

  /// A note as stored. `documentJson` is the serialized block document
  /// (`{version:1, blocks:[...]}`); `searchText` is the flattened plain text
  /// used for title + body search. `deletedAt` is `null` while the note is
  /// live and holds the soft-delete time once it is in the trash.
  public type Note = {
    id : Id;
    owner : Principal;
    title : Text;
    subjectLabel : ?Text;
    chapterLabel : ?Text;
    topicLabel : ?Text;
    documentJson : Text;
    searchText : Text;
    status : Text;
    revision : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
    deletedAt : ?Timestamp;
  };

  /// A note as returned to its owner in list and detail views.
  public type NoteView = {
    id : Id;
    title : Text;
    subjectLabel : ?Text;
    chapterLabel : ?Text;
    topicLabel : ?Text;
    documentJson : Text;
    status : Text;
    revision : Nat;
    createdAt : Timestamp;
    updatedAt : Timestamp;
    deletedAt : ?Timestamp;
  };

  /// A note share token as stored. Revoking or deleting the note removes it.
  public type NoteShare = {
    token : Text;
    noteId : Id;
    owner : Principal;
    status : Text;
    createdAt : Timestamp;
  };

  /// A public read-only note share link.
  public type NoteShareLink = {
    token : Text;
    noteId : Id;
    status : Text;
    createdAt : Timestamp;
  };

  /// The public read-only payload behind a note share token.
  public type SharedNote = {
    title : Text;
    documentJson : Text;
    revision : Nat;
    updatedAt : Timestamp;
  };

  /// Per-user settings. `appearance` is a free-form preference string.
  public type UserSettings = {
    owner : Principal;
    displayName : Text;
    studyGoal : Text;
    dailyTarget : Nat;
    appearance : Text;
    updatedAt : Timestamp;
  };

  /// The settings payload returned to the signed-in owner.
  public type UserSettingsView = {
    displayName : Text;
    studyGoal : Text;
    dailyTarget : Nat;
    appearance : Text;
    updatedAt : Timestamp;
  };

  /// A downloadable export of everything the signed-in owner stores.
  public type UserDataExport = {
    filename : Text;
    mimeType : Text;
    content : Text;
  };

  /// Errors returned by note operations.
  public type NoteError = {
    #notFound;
    #notAuthorized;
    #staleRevision : { expected : Nat; actual : Nat };
    #invalidInput : Text;
  };

  /// Errors returned by note share operations.
  public type NoteShareError = {
    #notFound;
    #notAuthorized;
  };

  /// Errors returned by settings operations.
  public type SettingsError = {
    #notAuthorized;
    #invalidInput : Text;
  };
};
