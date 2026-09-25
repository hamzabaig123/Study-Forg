/**
 * AI structuring client for StudyForge AI Studio.
 * Interfaces with Google Gemini, OpenRouter, OpenAI, and Platform Canister AI
 * with strict JSON response parsing, schema enforcement, and fallback recovery.
 */

export interface ExtractedQuestionItem {
  id: string;
  type: "mcq" | "short_qa";
  question: string;
  options?: string[]; // for mcq
  correctAnswer: string; // "A"|"B"|"C"|"D" or text for short_qa
  explanation?: string;
  inferred: boolean;
  sourcePage?: number;
}

export type AiProvider = "builtIn" | "gemini" | "openRouter" | "openAi";

export interface AiClientConfig {
  provider: AiProvider;
  geminiKey?: string;
  openRouterKey?: string;
  openAiKey?: string;
}

const STORAGE_KEYS = {
  PROVIDER: "studyforge.ai.provider",
  GEMINI_KEY: "studyforge.ai.gemini_key",
  OPENROUTER_KEY: "studyforge.ai.openrouter_key",
  OPENAI_KEY: "studyforge.ai.openai_key",
};

export function getStoredAiConfig(): AiClientConfig {
  if (typeof window === "undefined") {
    return { provider: "builtIn" };
  }
  const provider =
    (localStorage.getItem(STORAGE_KEYS.PROVIDER) as AiProvider) || "builtIn";
  const geminiKey = localStorage.getItem(STORAGE_KEYS.GEMINI_KEY) || undefined;
  const openRouterKey =
    localStorage.getItem(STORAGE_KEYS.OPENROUTER_KEY) || undefined;
  const openAiKey = localStorage.getItem(STORAGE_KEYS.OPENAI_KEY) || undefined;
  return { provider, geminiKey, openRouterKey, openAiKey };
}

export function saveStoredAiConfig(config: Partial<AiClientConfig>) {
  if (typeof window === "undefined") return;
  if (config.provider)
    localStorage.setItem(STORAGE_KEYS.PROVIDER, config.provider);
  if (config.geminiKey !== undefined) {
    if (config.geminiKey)
      localStorage.setItem(STORAGE_KEYS.GEMINI_KEY, config.geminiKey);
    else localStorage.removeItem(STORAGE_KEYS.GEMINI_KEY);
  }
  if (config.openRouterKey !== undefined) {
    if (config.openRouterKey)
      localStorage.setItem(STORAGE_KEYS.OPENROUTER_KEY, config.openRouterKey);
    else localStorage.removeItem(STORAGE_KEYS.OPENROUTER_KEY);
  }
  if (config.openAiKey !== undefined) {
    if (config.openAiKey)
      localStorage.setItem(STORAGE_KEYS.OPENAI_KEY, config.openAiKey);
    else localStorage.removeItem(STORAGE_KEYS.OPENAI_KEY);
  }
}

/* -------------------------------------------------------------------------- */
/* Prompt Specification                                                       */
/* -------------------------------------------------------------------------- */

const EXTRACTION_SYSTEM_PROMPT = `You are an expert educational document parser.
Analyze the provided document (text or image) and extract EVERY multiple-choice question (MCQ) and EVERY question-answer pair (short/descriptive questions) you can identify.

Return ONLY a valid JSON object matching this exact schema:
{
  "items": [
    {
      "type": "mcq",
      "question": "Question prompt text",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "correctAnswer": "B",
      "explanation": "Brief explanation or null",
      "inferred": false,
      "sourcePage": 1
    },
    {
      "type": "short_qa",
      "question": "Question prompt text",
      "correctAnswer": "Expected answer or model answer",
      "explanation": null,
      "inferred": false,
      "sourcePage": 1
    }
  ]
}

STRICT EXTRACTION RULES:
1. For "mcq", "options" MUST be an array of strings (minimum 2 options, usually 4). "correctAnswer" MUST be a single letter ("A", "B", "C", "D", etc.).
2. If the correct answer is NOT explicitly marked in the source document, deduce the correct answer and set "inferred": true. Otherwise set "inferred": false.
3. For "short_qa", "options" MUST be omitted or null. "correctAnswer" should contain the expected answer or solution.
4. Preserve exact mathematical notation, formulas, and terminology from the source.
5. If a question is incomplete or cutoff, skip it rather than guessing wildly.
6. Return ONLY pure JSON. Do NOT wrap in markdown fences (\`\`\`json) and do not provide introductory or concluding conversational text.`;

/* -------------------------------------------------------------------------- */
/* Robust JSON Parser & Sanitizer                                             */
/* -------------------------------------------------------------------------- */

export function parseAiExtractionJson(
  rawText: string,
): ExtractedQuestionItem[] {
  let cleaned = rawText.trim();

  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
  cleaned = cleaned.replace(/\s*```$/i, "");

  // Find the outermost JSON object bounds if there is extraneous prose
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_err) {
    // Attempt fallback line-by-line recovery or partial parsing
    const match = cleaned.match(/"items"\s*:\s*(\[[\s\S]*?\])\s*}/);
    if (match) {
      try {
        const itemsArr = JSON.parse(match[1]);
        parsed = { items: itemsArr };
      } catch {
        throw new Error(
          "The AI response could not be parsed as valid JSON. Please try again or inspect raw text.",
        );
      }
    } else {
      throw new Error("Invalid JSON returned by AI. Please try again.");
    }
  }

  const items = Array.isArray(parsed?.items)
    ? parsed.items
    : Array.isArray(parsed)
      ? parsed
      : [];
  const results: ExtractedQuestionItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;

    const question = String(item.question || item.prompt || "").trim();
    if (question.length < 2) continue;

    const rawType = String(item.type || "").toLowerCase();
    const isMcq =
      rawType.includes("mcq") ||
      rawType.includes("multiple") ||
      (Array.isArray(item.options) && item.options.length >= 2);
    const type: "mcq" | "short_qa" = isMcq ? "mcq" : "short_qa";

    let options: string[] | undefined = undefined;
    let correctAnswer = String(item.correctAnswer || item.answer || "").trim();

    if (isMcq) {
      const rawOptions = Array.isArray(item.options) ? item.options : [];
      options = rawOptions
        .map((opt: unknown) =>
          String(opt || "")
            .replace(/^[A-Da-d][\.\)]\s*/, "")
            .trim(),
        )
        .filter(Boolean);

      // Normalize MCQ answer to letter
      if (/^[0-9]+$/.test(correctAnswer)) {
        const num = Number.parseInt(correctAnswer, 10);
        correctAnswer = String.fromCharCode(
          64 + Math.max(1, Math.min(26, num)),
        );
      } else if (correctAnswer.length > 1) {
        // Try finding letter prefix e.g. "B) Photosynthesis" -> "B"
        const prefix = correctAnswer.match(/^[A-Da-d][\.\)]?/);
        if (prefix) {
          correctAnswer = prefix[0][0].toUpperCase();
        } else if (options && options.length > 0) {
          // If answer is full text matching one of the options
          const matchIdx = options.findIndex(
            (opt) => opt.toLowerCase() === correctAnswer.toLowerCase(),
          );
          if (matchIdx !== -1) {
            correctAnswer = String.fromCharCode(65 + matchIdx);
          } else {
            correctAnswer = "A";
          }
        } else {
          correctAnswer = "A";
        }
      } else {
        correctAnswer = correctAnswer.toUpperCase() || "A";
      }
    }

    results.push({
      id: `ai-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      question,
      options,
      correctAnswer,
      explanation: item.explanation
        ? String(item.explanation).trim()
        : undefined,
      inferred: Boolean(item.inferred),
      sourcePage: typeof item.sourcePage === "number" ? item.sourcePage : 1,
    });
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* Provider Implementations                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Call Google Gemini API (supporting text and multimodal images).
 */
async function callGemini(
  apiKey: string,
  prompt: string,
  image?: { base64Data: string; mimeType: string },
): Promise<string> {
  // Use gemini-2.0-flash or gemini-1.5-flash
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const parts: any[] = [];
  if (image) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64Data,
      },
    });
  }
  parts.push({
    text: `${EXTRACTION_SYSTEM_PROMPT}\n\nDocument / Content to extract from:\n${prompt}`,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let message = `Gemini API error (${res.status})`;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson?.error?.message) message = errJson.error.message;
    } catch {}
    throw new Error(message);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

/**
 * Call OpenRouter API (multimodal compatible).
 */
async function callOpenRouter(
  apiKey: string,
  prompt: string,
  imageDataUrl?: string,
): Promise<string> {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const content: any[] = [];

  if (imageDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: imageDataUrl },
    });
  }
  content.push({
    type: "text",
    text: `Document text/content:\n${prompt}`,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.origin,
      "X-Title": "StudyForge AI Studio",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-001",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let message = `OpenRouter API error (${res.status})`;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson?.error?.message) message = errJson.error.message;
    } catch {}
    throw new Error(message);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenRouter returned an empty response.");
  }
  return text;
}

/**
 * Call OpenAI API (supports gpt-4o-mini).
 */
async function callOpenAi(
  apiKey: string,
  prompt: string,
  imageDataUrl?: string,
): Promise<string> {
  const url = "https://api.openai.com/v1/chat/completions";
  const content: any[] = [];

  if (imageDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: imageDataUrl, detail: "high" },
    });
  }
  content.push({
    type: "text",
    text: `Document text/content:\n${prompt}`,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    let message = `OpenAI API error (${res.status})`;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson?.error?.message) message = errJson.error.message;
    } catch {}
    throw new Error(message);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }
  return text;
}

/* -------------------------------------------------------------------------- */
/* Main AI Structuring Entrypoint                                             */
/* -------------------------------------------------------------------------- */

export interface ExtractionRequest {
  rawText: string;
  imageDataUrl?: string;
  imageMimeType?: string;
  canisterGenerateFallback?: (text: string) => Promise<string>;
}

export async function extractAndStructureQuestions(
  req: ExtractionRequest,
  config?: AiClientConfig,
): Promise<ExtractedQuestionItem[]> {
  const activeConfig = config ?? getStoredAiConfig();
  let rawJson = "";

  // 1. If Gemini key is available and selected
  if (activeConfig.provider === "gemini" && activeConfig.geminiKey) {
    const imageParam =
      req.imageDataUrl && req.imageMimeType
        ? {
            base64Data: req.imageDataUrl.split(",")[1],
            mimeType: req.imageMimeType,
          }
        : undefined;
    rawJson = await callGemini(activeConfig.geminiKey, req.rawText, imageParam);
  }
  // 2. If OpenRouter key is available and selected
  else if (
    activeConfig.provider === "openRouter" &&
    activeConfig.openRouterKey
  ) {
    rawJson = await callOpenRouter(
      activeConfig.openRouterKey,
      req.rawText,
      req.imageDataUrl,
    );
  }
  // 3. If OpenAI key is available and selected
  else if (activeConfig.provider === "openAi" && activeConfig.openAiKey) {
    rawJson = await callOpenAi(
      activeConfig.openAiKey,
      req.rawText,
      req.imageDataUrl,
    );
  }
  // 4. Built-in Canister platform AI fallback
  else if (req.canisterGenerateFallback) {
    rawJson = await req.canisterGenerateFallback(req.rawText);
  } else {
    // If no provider key is saved, try Gemini key if stored, then OpenRouter, then OpenAI
    if (activeConfig.geminiKey) {
      const imageParam =
        req.imageDataUrl && req.imageMimeType
          ? {
              base64Data: req.imageDataUrl.split(",")[1],
              mimeType: req.imageMimeType,
            }
          : undefined;
      rawJson = await callGemini(
        activeConfig.geminiKey,
        req.rawText,
        imageParam,
      );
    } else if (activeConfig.openRouterKey) {
      rawJson = await callOpenRouter(
        activeConfig.openRouterKey,
        req.rawText,
        req.imageDataUrl,
      );
    } else if (activeConfig.openAiKey) {
      rawJson = await callOpenAi(
        activeConfig.openAiKey,
        req.rawText,
        req.imageDataUrl,
      );
    } else {
      throw new Error(
        "No AI provider configured. Please select Built-in AI, or provide a Google Gemini / OpenRouter / OpenAI key in AI settings.",
      );
    }
  }

  return parseAiExtractionJson(rawJson);
}
