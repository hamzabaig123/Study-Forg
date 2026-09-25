import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Runtime "mo:core/Runtime";

import Common "../types/common";
import AiTypes "../types/ai";
import JsonParser "json-parser";

import InferenceConfig "mo:caffeineai-inference-client/Config";
import InferenceChatApi "mo:caffeineai-inference-client/Apis/ChatApi";
import InferenceChatCompletionRequest "mo:caffeineai-inference-client/Models/ChatCompletionRequest";
import InferenceChatCompletionRequestMessageOneOf2 "mo:caffeineai-inference-client/Models/ChatCompletionRequestMessageOneOf2";

import OpenAIConfig "mo:openai-client/Config";
import OpenAIChatApi "mo:openai-client/Apis/ChatApi";
import OpenAICreateChatCompletionRequest "mo:openai-client/Models/CreateChatCompletionRequest";
import OpenAIChatCompletionRequestUserMessage "mo:openai-client/Models/ChatCompletionRequestUserMessage";

module {
  /// The masked hint shown for a saved key: the first three and last four
  /// characters, with the middle elided. Never the full key.
  func maskKey(key : Text) : Text {
    let chars = key.toArray();
    let size = chars.size();
    if (size <= 7) {
      return "••••";
    };
    let head = chars.sliceToArray(0, 3);
    let tail = chars.sliceToArray(size.toInt() - 4, size.toInt());
    head.concat(tail).toText();
  };
  /// The AI configuration state for `owner`. Never returns the key itself.
  public func getConfig(owner : Principal, aiKeys : Map.Map<Principal, Text>) : Common.AiConfigStatus {
    switch (aiKeys.get(owner)) {
      case (?key) { { hasPersonalKey = true; keyHint = ?maskKey(key) } };
      case null { { hasPersonalKey = false; keyHint = null } };
    };
  };

  /// Save (or replace) the caller's personal OpenAI key.
  public func saveKey(owner : Principal, key : Text, aiKeys : Map.Map<Principal, Text>) : Common.AiConfigStatus {
    let trimmed = key.trim(#predicate(func c = c == ' ' or c == '\t' or c == '\n' or c == '\r'));
    if (trimmed.size() == 0) {
      Runtime.trap("API key must not be empty");
    };
    aiKeys.add(owner, trimmed);
    { hasPersonalKey = true; keyHint = ?maskKey(trimmed) };
  };

  /// Remove the caller's personal OpenAI key.
  public func removeKey(owner : Principal, aiKeys : Map.Map<Principal, Text>) : Common.AiConfigStatus {
    aiKeys.remove(owner);
    { hasPersonalKey = false; keyHint = null };
  };

  /// Build the instruction sent to the model, grounding it in the optional
  /// pasted source text and pinning the exact JSON response shape.
  func buildPrompt(request : AiTypes.GenerateRequest) : Text {
    let sourceBlock = switch (request.sourceText) {
      case (?source) {
        if (source.size() == 0) { "" } else { "\n\nSource material to ground the questions in:\n" # source };
      };
      case null { "" };
    };
    "You are an expert teacher creating quiz questions.\n" #
    "Generate exactly " # request.count.toText() # " draft questions.\n" #
    "Instruction: " # request.prompt # sourceBlock # "\n\n" #
    "Respond with ONLY a JSON object, no prose and no markdown fences, in this exact shape:\n" #
    "{\"questions\":[{\"prompt\":\"...\",\"type\":\"multipleChoice\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"correctIndex\":0,\"explanation\":\"...\"}]}\n" #
    "Rules:\n" #
    "- \"type\" is one of \"multipleChoice\", \"trueFalse\", or \"shortAnswer\".\n" #
    "- For \"multipleChoice\", provide 2 to 6 \"options\" and a 0-based \"correctIndex\".\n" #
    "- For \"trueFalse\", omit \"options\" and set \"correct\" to true or false.\n" #
    "- For \"shortAnswer\", omit \"options\" and set \"expected\" to the expected answer text.\n" #
    "- \"explanation\" is optional; omit it when there is nothing useful to add.";
  };

  /// Extract the first balanced JSON object from a model response, tolerating
  /// markdown fences and surrounding prose.
  func extractJsonObject(raw : Text) : ?Text {
    let chars = raw.toArray();
    let size = chars.size();
    var start : ?Nat = null;
    var i = 0;
    while (i < size and start == null) {
      if (chars[i] == '{') { start := ?i };
      i += 1;
    };
    let from = switch (start) {
      case (?s) { s };
      case null { return null };
    };
    var depth = 0;
    var end : ?Nat = null;
    var j = from;
    while (j < size and end == null) {
      let c = chars[j];
      if (c == '{') { depth += 1 } else if (c == '}') {
        depth -= 1;
        if (depth == 0) { end := ?j };
      };
      j += 1;
    };
    let to = switch (end) {
      case (?e) { e };
      case null { return null };
    };
    ?chars.sliceToArray(from.toInt(), (to + 1).toInt()).toText();
  };

  /// Parse one JSON question value into a `DraftQuestion`, or `null` when the
  /// value is malformed or its answer data does not match its declared type.
  func parseQuestion(value : JsonParser.JsonValue, topicId : Common.Id, nextId : Common.Id) : ?Common.DraftQuestion {
    let fields = switch (value) {
      case (#obj entries) { entries };
      case _ { return null };
    };
    let prompt = switch (JsonParser.getText(fields, "prompt")) {
      case (?p) { p };
      case null { return null };
    };
    if (prompt.size() == 0) { return null };
    let explanation = JsonParser.getText(fields, "explanation");
    let kind = JsonParser.getText(fields, "type") ?? "multipleChoice";
    let answer : Common.AnswerData = if (kind == "trueFalse") {
      #trueFalse({ correct = JsonParser.getBool(fields, "correct") ?? false });
    } else if (kind == "shortAnswer") {
      let expected = JsonParser.getText(fields, "expected") ?? "";
      if (expected.size() == 0) { return null };
      #shortAnswer({ expected });
    } else {
      let optionTexts = JsonParser.getTextArray(fields, "options");
      if (optionTexts.size() < 2) { return null };
      let options = optionTexts.map(func text = { id = nextId; text });
      let correctIndex = JsonParser.getNat(fields, "correctIndex") ?? 0;
      let bounded = if (correctIndex >= options.size()) { 0 } else { correctIndex };
      let correctOptionId = options[bounded].id;
      #multipleChoice({ options; correctOptionId });
    };
    let questionType : Common.QuestionType = switch (answer) {
      case (#multipleChoice(_)) { #multipleChoice };
      case (#trueFalse(_)) { #trueFalse };
      case (#shortAnswer(_)) { #shortAnswer };
    };
    ?{
      id = nextId;
      topicId;
      prompt;
      questionType;
      answer;
      explanation;
    };
  };

  /// Parse a model response into draft questions. Returns `null` when the
  /// response carries no usable question.
  func parseDrafts(raw : Text, topicId : Common.Id, nextId : Common.Id) : ?[Common.DraftQuestion] {
    let json = extractJsonObject(raw) ?? return null;
    let parsed = switch (JsonParser.parse(json)) {
      case (#ok value) { value };
      case (#err _) { return null };
    };
    let fields = switch (parsed) {
      case (#obj entries) { entries };
      case _ { return null };
    };
    let rawQuestions = JsonParser.getArray(fields, "questions") ?? return null;
    var index = 0;
    let drafts = rawQuestions.filterMap(
      func(item) {
        let parsed = parseQuestion(item, topicId, nextId + index);
        index += 1;
        parsed;
      }
    );
    if (drafts.size() == 0) { return null };
    ?drafts;
  };

  /// Generate draft questions for a topic using the platform AI, or the
  /// caller's personal key when one is saved.
  public func generate<system>(
    owner : Principal,
    request : AiTypes.GenerateRequest,
    aiKeys : Map.Map<Principal, Text>,
  ) : async* Result.Result<AiTypes.GenerateResult, Common.AiError> {
    if (request.count == 0) {
      return #err(#invalidRequest("Ask for at least one question"));
    };
    let hasSource = switch (request.sourceText) {
      case (?source) { source.size() > 0 };
      case null { false };
    };
    if (request.prompt.size() == 0 and not hasSource) {
      return #err(#invalidRequest("Provide a prompt or some source text"));
    };
    let prompt = buildPrompt(request);
    let (raw, source) = switch (aiKeys.get(owner)) {
      case (?key) {
        let config = {
          OpenAIConfig.defaultConfig with
          auth = ?#bearer key;
          is_replicated = ?false;
        };
        let userMessage = OpenAIChatCompletionRequestUserMessage.JSON.init({
          content = #string(prompt);
          role = #user;
        });
        let req = OpenAICreateChatCompletionRequest.JSON.init({
          messages = [#user(userMessage)];
          model = "gpt-4o-mini";
        });
        let resp = try {
          await* OpenAIChatApi.createChatCompletion(config, req);
        } catch (_) {
          return #err(#generationFailed("The AI request failed. Check your OpenAI key and try again."));
        };
        if (resp.choices.size() == 0) {
          return #err(#generationFailed("The AI returned no questions. Try rephrasing your prompt."));
        };
        let content = resp.choices[0].message.content ?? return #err(#generationFailed("The AI returned no text content."));
        (content, #personalKey);
      };
      case null {
        let config = InferenceConfig.fromEnv<system>();
        let userMessage = InferenceChatCompletionRequestMessageOneOf2.JSON.init({
          content = #string(prompt);
          role = #user;
        });
        let req = InferenceChatCompletionRequest.JSON.init({
          messages = [#user(userMessage)];
          model = "router";
        });
        let resp = try {
          await* InferenceChatApi.createChatCompletion(config, req);
        } catch (_) {
          return #err(#generationFailed("The AI request failed. Please try again."));
        };
        if (resp.choices.size() == 0) {
          return #err(#generationFailed("The AI returned no questions. Try rephrasing your prompt."));
        };
        let content = resp.choices[0].message.content ?? return #err(#generationFailed("The AI returned no text content."));
        (content, #platform);
      };
    };
    let drafts = parseDrafts(raw, request.topicId, 0) ?? return #err(#generationFailed("The AI response could not be understood. Try again."));
    #ok({ drafts = drafts.map(func draft = { draft; source }); source });
  };
};
