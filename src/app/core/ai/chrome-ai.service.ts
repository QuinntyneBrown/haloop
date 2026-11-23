import { Injectable, inject } from '@angular/core';
import { MlWorkerClient } from './ml-worker.client';

interface PromptSessionLike {
  prompt(input: string): Promise<string>;
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
  private promptSession: PromptSessionLike | null = null;

  async promptCoach(userPrompt: string): Promise<{ text: string; reflection: string; engine: string }> {
    const g = globalThis as unknown as ChromeAiGlobal;
    if (g.LanguageModel) {
      try {
        this.promptSession ??= await g.LanguageModel.create({
          systemPrompt:
            'You are Haloop Coach, a concise, encouraging on-device movement and devotional coach. Respond in 2-3 sentences.',
        });
        const text = await this.promptSession.prompt(userPrompt);
        if (!text.startsWith('On-device model is not available in Chromium')) {
          return {
            text,
            reflection: 'Isaiah 40:31 — wait upon the LORD to renew your strength.',
            engine: 'Haloop Coach · Gemini Nano',
          };
        }
      } catch {
        // Fall through to local Web Worker fallback.
      }
    }

    const fallback = await this.worker.generateCoachReply(userPrompt);
    return {
      text: fallback.reply,
      reflection: fallback.reflection,
      engine: `Haloop Coach · ${fallback.engine}`,
    };
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
