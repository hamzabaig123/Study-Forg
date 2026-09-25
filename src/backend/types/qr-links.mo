module {
  /// Stable identifier for a short link.
  public type LinkId = Nat;

  /// A short code as it appears in the app's own short URL path
  /// (`<app>/r/<code>`). Lowercase alphanumeric.
  public type ShortCode = Text;

  /// The secret token embedded in the manage link. Anyone holding it may
  /// manage the link; no sign-in is required.
  public type EditToken = Text;

  /// Lifecycle state of a short link.
  public type LinkStatus = {
    #active;
    #paused;
    #deleted;
  };

  /// A short link as stored.
  public type ShortLink = {
    id : LinkId;
    code : ShortCode;
    targetUrl : Text;
    editToken : EditToken;
    status : LinkStatus;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// A short link as returned to its manager (edit-token holder).
  public type LinkDetail = {
    id : LinkId;
    code : ShortCode;
    shortUrl : Text;
    targetUrl : Text;
    status : LinkStatus;
    createdAt : Timestamp;
    updatedAt : Timestamp;
  };

  /// The result of creating a link: the short URL to encode in the QR code,
  /// plus the secret manage URL. The edit token is returned exactly once.
  public type CreatedLink = {
    id : LinkId;
    code : ShortCode;
    shortUrl : Text;
    manageUrl : Text;
    editToken : EditToken;
    targetUrl : Text;
    status : LinkStatus;
    createdAt : Timestamp;
  };

  /// Why a short code could not be resolved to a redirect.
  public type UnavailableReason = {
    #notFound;
    #paused;
    #deleted;
    #rateLimited;
  };

  /// The outcome of resolving a short code.
  public type ResolveResult = {
    #redirect : { targetUrl : Text };
    #unavailable : UnavailableReason;
  };

  /// Device class recorded for a scan. Never derived from a raw IP address.
  public type DeviceType = {
    #mobile;
    #tablet;
    #desktop;
    #other;
  };

  /// One recorded scan. Deliberately carries no IP address.
  public type ScanRecord = {
    linkId : LinkId;
    scannedAt : Timestamp;
    device : DeviceType;
    country : ?Text;
  };

  /// One day of the scans-per-day series.
  public type DailyScanCount = {
    day : Text;
    count : Nat;
  };

  /// Scan statistics for a link, keyed by its edit token.
  public type ScanStats = {
    totalScans : Nat;
    perDay : [DailyScanCount];
  };

  /// Errors returned by link creation.
  public type CreateLinkError = {
    #invalidUrl : Text;
    #rateLimited;
  };

  /// Errors returned by edit-token-gated management operations.
  public type ManageLinkError = {
    #notFound;
    #notAuthorized;
    #invalidUrl : Text;
  };

  /// Errors returned by abuse reports.
  public type AbuseError = {
    #notFound;
    #invalidInput : Text;
  };

  /// A recorded abuse report.
  public type AbuseReport = {
    code : ShortCode;
    reason : Text;
    reportedAt : Timestamp;
  };

  /// Nanoseconds since the epoch (`Time.now()`).
  public type Timestamp = Int;
};
