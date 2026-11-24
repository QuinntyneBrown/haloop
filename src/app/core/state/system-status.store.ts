import { Injectable, computed, inject, signal } from '@angular/core';
import { BrowserCapabilityService } from '../capabilities/browser-capability.service';
import { PreferencesStore } from './preferences.store';

export type BannerSeverity = 'info' | 'success' | 'warning' | 'danger' | 'persistent';

export interface SystemBanner {
  readonly id: string;
  readonly severity: BannerSeverity;
  readonly message: string;
  readonly actionLabel: string;
  readonly actionRoute: string;
  readonly dismissible: boolean;
}

@Injectable({ providedIn: 'root' })
export class SystemStatusStore {
  private readonly capabilities = inject(BrowserCapabilityService);
  private readonly prefs = inject(PreferencesStore);

  readonly isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  readonly linkedDeviceCount = signal<number>(2);
  readonly cachedModelCount = signal<number>(4);
  readonly cachedModelMb = signal<number>(286);
  readonly dismissedBannerIds = signal<ReadonlySet<string>>(new Set());
  /** Model downloads that stopped when the connection dropped and can be resumed from AI Lab. */
  readonly pausedDownloadCount = signal<number>(0);
  /** True after a real offline -> online transition, so the banner is not shown on a normal page load. */
  readonly cameBackOnline = signal<boolean>(false);

  readonly storageUsagePercent = computed(() => {
    const budget = Math.max(512, this.prefs.preferences().cacheBudgetMb);
    return Math.min(100, Math.round((this.cachedModelMb() / budget) * 100));
  });

  readonly wasmFallbackActive = computed(
    () =>
      this.prefs.preferences().preferredBackend === 'WasmCpu' ||
      !this.capabilities.report().webGpuAvailable,
  );

  readonly activeBanner = computed<SystemBanner | null>(() => {
    const dismissed = this.dismissedBannerIds();

    if (this.storageUsagePercent() >= 90 && !dismissed.has('storage-full')) {
      return {
        id: 'storage-full',
        severity: 'danger',
        message: `Browser storage nearly full — ${this.cachedModelMb()} MB of ${this.prefs.preferences().cacheBudgetMb} MB used; new sessions may fail to save.`,
        actionLabel: 'Manage cache',
        actionRoute: '/lab',
        dismissible: true,
      };
    }

    if (this.isOnline() && this.cameBackOnline() && this.pausedDownloadCount() > 0 && !dismissed.has('back-online')) {
      return {
        id: 'back-online',
        severity: 'success',
        message: 'Back online — paused Hugging Face model downloads can resume.',
        actionLabel: 'Open AI Lab',
        actionRoute: '/lab',
        dismissible: true,
      };
    }

    if (!this.isOnline() && !dismissed.has('offline')) {
      return {
        id: 'offline',
        severity: 'info',
        message: `Offline mode active — all ${this.cachedModelCount()} cached models and Gemini Nano remain ready in this tab.`,
        actionLabel: 'Details',
        actionRoute: '/offline',
        dismissible: true,
      };
    }

    if (this.wasmFallbackActive() && !dismissed.has('wasm-fallback')) {
      return {
        id: 'wasm-fallback',
        severity: 'warning',
        message: 'Running on CPU via WebAssembly — WebGPU is unavailable or disabled in this Chrome window.',
        actionLabel: 'Learn more',
        actionRoute: '/lab',
        dismissible: true,
      };
    }

    return null;
  });

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        this.cameBackOnline.set(true);
        // A fresh offline spell must be able to raise the banner again.
        this.dismissedBannerIds.update((ids) => new Set([...ids].filter((id) => id !== 'back-online')));
      });
      window.addEventListener('offline', () => {
        this.isOnline.set(false);
        this.cameBackOnline.set(false);
      });
    }
  }

  dismissBanner(id: string): void {
    this.dismissedBannerIds.update((prev) => new Set([...prev, id]));
  }
}
