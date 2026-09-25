import Common "../types/common";

module {
  public type Id = Common.Id;
  public type Timestamp = Common.Timestamp;
  public type ShareTarget = Common.ShareTarget;
  public type ShareLink = Common.ShareLink;
  public type SharedContent = Common.SharedContent;
  public type ShareError = Common.ShareError;
  public type ExportError = Common.ExportError;
  public type ExportFile = Common.ExportFile;

  /// A share token as stored.
  public type Share = {
    token : Text;
    owner : Principal;
    target : ShareTarget;
    createdAt : Timestamp;
  };

  /// The format requested for an export.
  public type ExportFormat = {
    #csv;
    #pdf;
  };
};
