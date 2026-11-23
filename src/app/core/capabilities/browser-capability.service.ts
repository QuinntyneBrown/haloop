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

interface ChromeAiWindow {
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

  async recheck(): Promise<CapabilityReport> {
    const next = this.probeSync();
    this.report.set(next);
    return next;
  }

  enableWriterFlagSimulated(): void {
    this.report.update((r) => ({ ...r, writerFlagEnabled: true }));
  }
}
