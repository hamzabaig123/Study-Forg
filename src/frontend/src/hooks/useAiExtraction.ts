/**
 * The state behind one AI Studio run: the document that was read, the text the
 * reviewer pasted, and the extraction in flight.
 *
 * Provider keys live in local storage and are read through `lib/ai/providers`;
 * `useAiProviders` keeps that state in memory and re-reads it when the key
 * dialog saves.
 */

import {
  type SourceDocument,
  describeDocument,
  readDocument,
} from "@/lib/ai/document";
import {
  type ExtractionProgress,
  NoReadableSourceError,
  extractQuestions,
} from "@/lib/ai/extract";
import {
  type ActiveProvider,
  OFFLINE_CHOICE,
  type ProviderChoice,
  type ProviderId,
  activeProvider,
  offlineChosen,
  preferredChoice,
  removeKey,
  saveKey,
  setPreferredChoice,
  storedKeys,
} from "@/lib/ai/providers";
import type { QuestionDraft } from "@/lib/ai/questions";
import { useStudioStore } from "@/lib/ai/studioStore";
import { useCallback, useMemo, useRef, useState } from "react";

export interface ProviderState {
  /** Provider extraction would use now, or null when parsing offline. */
  active: ActiveProvider | null;
  offlineChosen: boolean;
  preference: ProviderChoice | null;
  keys: Record<ProviderId, string>;
}

function readProviderState(): ProviderState {
  return {
    active: activeProvider(),
    offlineChosen: offlineChosen(),
    preference: preferredChoice(),
    keys: storedKeys(),
  };
}

export function useAiProviders() {
  const [providers, setProviders] = useState<ProviderState>(readProviderState);
  const refresh = useCallback(() => setProviders(readProviderState()), []);

  const connect = useCallback(
    (id: ProviderId, key: string) => {
      saveKey(id, key);
      setPreferredChoice(key.trim() ? id : null);
      refresh();
    },
    [refresh],
  );

  /** For a provider that needs no key: use it, since the reviewer asked. */
  const choose = useCallback(
    (id: ProviderId) => {
      setPreferredChoice(id);
      refresh();
    },
    [refresh],
  );

  const disconnect = useCallback(
    (id: ProviderId) => {
      removeKey(id);
      refresh();
    },
    [refresh],
  );

  const chooseOffline = useCallback(() => {
    setPreferredChoice(OFFLINE_CHOICE);
    refresh();
  }, [refresh]);

  /** Back to "whatever key is saved", after selecting a provider in the dialog. */
  const followKey = useCallback(() => {
    if (!offlineChosen()) return;
    setPreferredChoice(null);
    refresh();
  }, [refresh]);

  return { providers, connect, choose, disconnect, chooseOffline, followKey };
}

export type ExtractionPhase = "idle" | "reading" | "extracting";

export interface RunResult {
  drafts: QuestionDraft[];
  /** How many drafts the queue holds now — more than `drafts.length` after a retry merged in. */
  queued: number;
  engine: "model" | "offline";
  providerName: string | null;
  /** A model the run fell back to, or null when the chosen model answered. */
  model: string | null;
  /** Sections the provider refused; their questions are missing from `drafts`. */
  skipped: number;
  /** Pages the run never read, so the queue can keep saying so. */
  missing: number[];
  /** Why sections were lost, so the toast can name the real reason. */
  warnings: string[];
}

const PASTED_FILE_NAME = "Pasted text";

export function useAiExtraction() {
  const [uploaded, setUploaded] = useState<SourceDocument | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [phase, setPhase] = useState<ExtractionPhase>("idle");
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replaceQueue = useStudioStore((state) => state.replaceQueue);
  const mergeDrafts = useStudioStore((state) => state.mergeDrafts);
  const runId = useRef(0);

  const loadFile = useCallback(async (file: File) => {
    const id = runId.current + 1;
    runId.current = id;
    setPhase("reading");
    setError(null);
    try {
      const read = await readDocument(file);
      if (runId.current !== id) return;
      setUploaded(read);
    } catch (cause) {
      if (runId.current !== id) return;
      setUploaded(null);
      setError(cause instanceof Error ? cause.message : "Could not read file.");
    } finally {
      if (runId.current === id) setPhase("idle");
    }
  }, []);

  const clearFile = useCallback(() => {
    runId.current += 1;
    setUploaded(null);
    setError(null);
    setPhase("idle");
  }, []);

  /** The document extraction will read: the upload, the paste, or both. */
  const effectiveSource = useMemo<SourceDocument | null>(() => {
    // An image or a scan carries no text, so pasted text cannot rescue it.
    if (uploaded?.needsVision) return uploaded;
    const pasted = pasteText.trim();
    if (!pasted) return uploaded;
    if (uploaded?.text.trim()) {
      return { ...uploaded, text: `${uploaded.text}\n\n${pasted}` };
    }
    return {
      fileName: PASTED_FILE_NAME,
      fileSize: pasted.length,
      kind: "text",
      text: pasted,
      images: [],
      pageCount: 1,
      needsVision: false,
      truncated: false,
      pagesSkipped: 0,
    };
  }, [uploaded, pasteText]);

  const summary = effectiveSource ? describeDocument(effectiveSource) : null;

  /**
   * Extract, either with the configured provider or with the rule-based parser.
   * `forceOffline` is the retry offered after a provider failure, and is also
   * what runs when no key is connected.
   */
  const run = useCallback(
    async (forceOffline = false): Promise<RunResult> => {
      const source = effectiveSource;
      if (!source) throw new Error("Upload a file or paste text first.");

      const id = runId.current + 1;
      runId.current = id;
      setPhase("extracting");
      setError(null);
      setProgress({ message: "Starting…", done: 0, total: 1 });

      try {
        if (forceOffline) {
          setProgress({
            message: "Reading the text layer…",
            done: 1,
            total: 1,
          });
          const offline = await extractQuestions(
            { ...source, images: [] },
            { onProgress: setProgress },
          );
          if (runId.current === id) {
            replaceQueue(offline.drafts, {
              fileName: source.fileName,
              engine: "offline",
              providerName: null,
              missing: [],
            });
          }
          return {
            drafts: offline.drafts,
            queued: useStudioStore.getState().drafts.length,
            engine: "offline",
            providerName: null,
            model: null,
            skipped: 0,
            missing: [],
            warnings: [],
          };
        }

        const outcome = await extractQuestions(source, {
          onProgress: setProgress,
        });
        if (runId.current === id) {
          const queue = {
            fileName: source.fileName,
            engine: outcome.engine,
            providerName: outcome.providerName,
            missing: outcome.missing,
          } as const;
          const current = useStudioStore.getState().source;
          // A run that lost sections is the one the reviewer is told to repeat,
          // and repeating it must add the pages that were missing rather than
          // discard the pages that came through.
          const retry =
            outcome.skipped > 0 && current?.fileName === source.fileName;
          if (retry) mergeDrafts(outcome.drafts, queue);
          else replaceQueue(outcome.drafts, queue);
        }
        return {
          drafts: outcome.drafts,
          queued: useStudioStore.getState().drafts.length,
          engine: outcome.engine,
          providerName: outcome.providerName,
          model: outcome.model,
          skipped: outcome.skipped,
          missing: outcome.missing,
          warnings: outcome.warnings,
        };
      } catch (cause) {
        const message =
          cause instanceof NoReadableSourceError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : "Extraction failed.";
        if (runId.current === id) setError(message);
        throw new Error(message);
      } finally {
        if (runId.current === id) {
          setPhase("idle");
          setProgress(null);
        }
      }
    },
    [effectiveSource, mergeDrafts, replaceQueue],
  );

  return {
    document: uploaded,
    pasteText,
    setPasteText,
    loadFile,
    clearFile,
    effectiveSource,
    summary,
    phase,
    progress,
    error,
    setError,
    run,
  };
}
