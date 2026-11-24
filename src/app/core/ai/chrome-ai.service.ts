import { Injectable, inject } from '@angular/core';
import { PreferencesStore } from '../state/preferences.store';
import { MlWorkerClient } from './ml-worker.client';

interface PromptSessionLike {
  prompt(input: string): Promise<string>;
  promptStreaming?(input: string): AsyncIterable<string>;
}

const ECHO_STUB = 'On-device model is not available in Chromium';

/** Chrome recycled a Gemini Nano session that was already in use; the user can restart it or open AI Lab. */
export class GeminiSessionInterruptedError extends Error {
  constructor() {
    super('The Gemini Nano Prompt API session was interrupted.');
    this.name = 'GeminiSessionInterruptedError';
  }
}

interface SummarizerLike {
  summarize(input: string): Promise<string>;
}

interface TranslatorLike {
  translate(input: string): Promise<string>;
}

interface ChromeAiGlobal {
  LanguageModel?: {
    create(opts?: { systemPrompt?: string }): Promise<PromptSessionLike>;
  };
  Summarizer?: {
    create(): Promise<SummarizerLike>;
  };
  Translator?: {
    create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorLike>;
  };
}

/**
 * Adapter for Chrome's Built-in Gemini Nano APIs (Prompt, Summarizer, Translator)
 * with automatic fallback to the local ML Web Worker when Chrome flags are off (L2-012, L2-014, L2-015, L2-027).
 */
@Injectable({ providedIn: 'root' })
export class ChromeAiService {
  private readonly worker = inject(MlWorkerClient);
  private readonly prefs = inject(PreferencesStore);
  private promptSession: PromptSessionLike | null = null;

  async promptCoach(
    userPrompt: string,
    onChunk?: (accumulated: string) => void,
  ): Promise<{ text: string; reflection: string; engine: string }> {
    const g = globalThis as unknown as ChromeAiGlobal;
    if (g.LanguageModel) {
      const reusedSession = this.promptSession !== null;
      try {
        this.promptSession ??= await g.LanguageModel.create({
          systemPrompt:
            'You are Haloop Coach, a concise, encouraging on-device movement and devotional coach. Respond in 2-3 sentences.',
        });
        const text = await this.runGeminiPrompt(this.promptSession, userPrompt, onChunk);
        if (!text.startsWith(ECHO_STUB)) {
          return {
            text,
            reflection: 'Isaiah 40:31 — wait upon the LORD to renew your strength.',
            engine: 'Haloop Coach · Gemini Nano',
          };
        }
      } catch {
        if (reusedSession) {
          // A session that worked before and now fails was recycled by Chrome: surface it so the UI can recover.
          this.promptSession = null;
          throw new GeminiSessionInterruptedError();
        }
        // First-use failure: fall through to the local Web Worker fallback.
      }
    }

    let accumulated = '';
    const fallback = await this.worker.generateCoachReply(
      userPrompt,
      this.prefs.preferences().preferredBackend,
      onChunk
        ? (chunk) => {
            accumulated += chunk;
            onChunk(accumulated);
          }
        : undefined,
    );
    return {
      text: fallback.reply,
      reflection: fallback.reflection,
      engine: `Haloop Coach · ${fallback.engine}`,
    };
  }

  /**
   * Streams via `promptStreaming()` when available. Chunks are held back while the text could still be
   * the Chromium echo stub so the stub never flashes in the UI; chunks are deltas, accumulated for the caller.
   */
  private async runGeminiPrompt(
    session: PromptSessionLike,
    input: string,
    onChunk?: (accumulated: string) => void,
  ): Promise<string> {
    if (!onChunk || !session.promptStreaming) {
      return session.prompt(input);
    }
    let text = '';
    let revealed = false;
    for await (const chunk of session.promptStreaming(input)) {
      text += chunk;
      if (!revealed && !ECHO_STUB.startsWith(text) && !text.startsWith(ECHO_STUB)) {
        revealed = true;
      }
      if (revealed) {
        onChunk(text);
      }
    }
    return text;
  }

  resetPromptSession(): void {
    this.promptSession = null;
  }

  async summarizeText(input: string, fallback: string): Promise<string> {
    const g = globalThis as unknown as ChromeAiGlobal;
    if (g.Summarizer) {
      try {
        const summarizer = await g.Summarizer.create();
        return await summarizer.summarize(input);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  async translateText(text: string, targetLanguage: string, fallback: string): Promise<string> {
    if (targetLanguage === 'en') {
      return text;
    }
    const g = globalThis as unknown as ChromeAiGlobal;
    if (g.Translator) {
      try {
        const translator = await g.Translator.create({ sourceLanguage: 'en', targetLanguage });
        return await translator.translate(text);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}
