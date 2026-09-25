import List "mo:core/List";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";

import Common "../types/common";
import AiTypes "../types/ai";
import AiLib "../lib/ai";

mixin (aiKeys : Map.Map<Principal, Text>, drafts : Map.Map<Common.Id, Common.DraftQuestion>) {
  /// The caller's AI configuration state. Never returns the saved key.
  public shared ({ caller }) func getAiConfig() : async Common.AiConfigStatus {
    AiLib.getConfig(caller, aiKeys);
  };

  /// Save (or replace) the caller's personal OpenAI key.
  public shared ({ caller }) func saveAiKey(key : Text) : async Common.AiConfigStatus {
    if (caller.isAnonymous()) {
      Runtime.trap("Sign in to save an API key");
    };
    AiLib.saveKey(caller, key, aiKeys);
  };

  /// Remove the caller's personal OpenAI key.
  public shared ({ caller }) func removeAiKey() : async Common.AiConfigStatus {
    if (caller.isAnonymous()) {
      Runtime.trap("Sign in to manage your API key");
    };
    AiLib.removeKey(caller, aiKeys);
  };

  /// Generate draft questions for a topic.
  public shared ({ caller }) func generateDrafts(request : AiTypes.GenerateRequest) : async Result.Result<AiTypes.GenerateResult, Common.AiError> {
    if (caller.isAnonymous()) {
      Runtime.trap("Sign in to generate questions");
    };
    let result = await* AiLib.generate<system>(caller, request, aiKeys);
    switch (result) {
      case (#ok generated) {
        if (drafts.size() > 100) {
          let doomed = List.empty<Common.Id>();
          for (id in drafts.keys()) {
            doomed.add(id);
          };
          for (id in doomed.values()) {
            drafts.remove(id);
          };
        };
        for (draft in generated.drafts.values()) {
          drafts.add(draft.draft.id, draft.draft);
        };
      };
      case (#err _) {};
    };
    result;
  };
};
