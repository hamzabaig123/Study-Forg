import Common "../types/common";

module {
  public type Id = Common.Id;
  public type DraftQuestion = Common.DraftQuestion;
  public type GeneratedDraft = Common.GeneratedDraft;
  public type AiConfigStatus = Common.AiConfigStatus;
  public type AiError = Common.AiError;
  public type AiSource = Common.AiSource;

  /// A request to generate draft questions for a topic.
  public type GenerateRequest = {
    topicId : Id;
    /// Free-form instruction, e.g. "5 questions about the water cycle".
    prompt : Text;
    /// Optional pasted source text the drafts must be grounded in.
    sourceText : ?Text;
    /// How many drafts to generate.
    count : Nat;
  };

  /// The result of a generation request.
  public type GenerateResult = {
    drafts : [GeneratedDraft];
    source : AiSource;
  };
};
