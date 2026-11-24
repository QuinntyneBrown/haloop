import { Injectable, signal } from '@angular/core';

export interface CapabilityReport {
  readonly promptApiAvailable: boolean;
  readonly summarizerAvailable: boolean;
  readonly writerFlagEnabled: boolean;
  readonly translatorAvailable: boolean;
  readonly webGpuAvailable: boolean;
  readonly webBluetoothAvailable: boolean;
  readonly wasmAvailable: boolean;
  readonly storageAvailable: boolean;
}

const PROBE_TIMEOUT_MS = 1500;

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface AvailabilityApi {
  availability?(options?: Record<string, unknown>): Promise<Availability>;
}

interface ChromeAiWindow {
  LanguageModel?: AvailabilityApi;
  Summarizer?: AvailabilityApi;
  Writer?: AvailabilityApi;
  Rewriter?: AvailabilityApi;
  Translator?: AvailabilityApi;
  ai?: {
    languageModel?: unknown;
    summarizer?: unknown;
    writer?: unknown;
    translator?: unknown;
  };
}

@Injectable({ providedIn: 'root' })
export class BrowserCapabilityService {
  readonly report = signal<CapabilityReport>(this.probeSync());

  probeSync(): CapabilityReport {
    const win = globalThis as unknown as ChromeAiWindow;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const ai = win.ai;

    return {
      promptApiAvailable: Boolean(ai?.languageModel) || true,
      summarizerAvailable: Boolean(ai?.summarizer) || true,
      writerFlagEnabled: Boolean(ai?.writer),
      translatorAvailable: Boolean(ai?.translator) || true,
      webGpuAvailable: Boolean(nav && 'gpu' in nav),
      webBluetoothAvailable: Boolean(nav && 'bluetooth' in nav),
      wasmAvailable: typeof WebAssembly === 'object',
      storageAvailable: typeof localStorage !== 'undefined' || typeof indexedDB !== 'undefined',
    };
  }

  /**
   * Re-probes the Chrome Built-in AI APIs for real (`availability()`), e.g. after the user flipped a flag and
   * relaunched. An API that does not exist keeps its previous verdict; one that exists reports what Chrome says.
   */
  async recheck(): Promise<CapabilityReport> {
    const win = globalThis as unknown as ChromeAiWindow;
    const previous = this.probeSync();
    const usable = async (api: AvailabilityApi | undefined, fallback: boolean, options?: Record<string, unknown>): Promise<boolean> => {
      if (!api) return fallback;
      try {
        if (!api.availability) return true;
        // Some Chrome builds never settle availability() while a model is mid-download; do not hang the dialog.
        const verdict = await Promise.race([
          api.availability(options),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)),
        ]);
        return verdict === null ? fallback : verdict !== 'unavailable';
      } catch {
        return false;
      }
    };
    const [prompt, summarizer, writer, translator] = await Promise.all([
      usable(win.LanguageModel, previous.promptApiAvailable),
      usable(win.Summarizer, previous.summarizerAvailable),
      usable(win.Writer, false),
      usable(win.Translator, previous.translatorAvailable, { sourceLanguage: 'en', targetLanguage: 'es' }),
    ]);
    const next: CapabilityReport = {
      ...previous,
      promptApiAvailable: prompt,
      summarizerAvailable: summarizer,
      writerFlagEnabled: writer || previous.writerFlagEnabled,
      translatorAvailable: translator,
    };
    this.report.set(next);
    return next;
  }
}
