import { Injectable, inject, signal } from '@angular/core';
import { HaloopDbService } from '../storage/haloop-db.service';
import {
  normalizeText,
  validateCacheBudgetMb,
  validateDisplayName,
} from '../security/sanitize';

export type MovementFocus = 'StrengthMobility' | 'RunningEndurance' | 'GentleDailyHabit';
export type InferenceBackend = 'AutoWebGpu' | 'WasmCpu';
export type ThemeMode = 'light' | 'dark';

export interface UserPreferences {
  readonly displayName: string;
  readonly movementFocus: MovementFocus;
  readonly scriptureLanguage: string;
  readonly preferredBackend: InferenceBackend;
  readonly cacheBudgetMb: number;
  readonly kokoroTtsEnabled: boolean;
  readonly onboardingCompleted: boolean;
  readonly theme: ThemeMode;
}

export interface PreferenceValidationError {
  readonly field: string;
  readonly message: string;
}

export const SUPPORTED_SCRIPTURE_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English (KJV)' },
  { code: 'es', label: 'Spanish (translated via Chrome Translator)' },
  { code: 'fr', label: 'French (translated via Chrome Translator)' },
  { code: 'pt', label: 'Portuguese (translated via Chrome Translator)' },
  { code: 'de', label: 'German (translated via Chrome Translator)' },
  { code: 'it', label: 'Italian (translated via Chrome Translator)' },
  { code: 'ko', label: 'Korean (translated via Chrome Translator)' },
  { code: 'ja', label: 'Japanese (translated via Chrome Translator)' },
  { code: 'zh', label: 'Chinese (translated via Chrome Translator)' },
  { code: 'ar', label: 'Arabic (translated via Chrome Translator)' },
  { code: 'hi', label: 'Hindi (translated via Chrome Translator)' },
  { code: 'sw', label: 'Swahili (translated via Chrome Translator)' },
];

const DEFAULT_PREFERENCES: UserPreferences = {
  displayName: 'Micah Osei',
  movementFocus: 'StrengthMobility',
  scriptureLanguage: 'en',
  preferredBackend: 'AutoWebGpu',
  cacheBudgetMb: 2048,
  kokoroTtsEnabled: true,
  onboardingCompleted: false,
  theme: 'light',
};

@Injectable({ providedIn: 'root' })
export class PreferencesStore {
  private readonly db = inject(HaloopDbService);

  readonly preferences = signal<UserPreferences>(DEFAULT_PREFERENCES);
  readonly loading = signal<boolean>(false);
  readonly submitting = signal<boolean>(false);
  readonly savedMessage = signal<string | null>(null);
  readonly storageError = signal<string | null>(null);
  readonly validationErrors = signal<readonly PreferenceValidationError[]>([]);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.storageError.set(null);
    try {
      const saved = await this.db.get<UserPreferences>('preferences');
      if (saved) {
        this.preferences.set({ ...DEFAULT_PREFERENCES, ...saved });
        this.applyTheme(saved.theme ?? 'light');
      }
    } catch {
      this.storageError.set('Browser storage is currently unavailable. Try reloading this tab.');
    } finally {
      this.loading.set(false);
    }
  }

  validate(draft: UserPreferences): PreferenceValidationError[] {
    const errors: PreferenceValidationError[] = [];
    const nameErr = validateDisplayName(draft.displayName);
    if (nameErr) {
      errors.push({ field: 'displayName', message: nameErr });
    }
    const budgetErr = validateCacheBudgetMb(draft.cacheBudgetMb);
    if (budgetErr) {
      errors.push({ field: 'cacheBudgetMb', message: budgetErr });
    }
    return errors;
  }

  async save(draft: Partial<UserPreferences>): Promise<boolean> {
    const merged: UserPreferences = {
      ...this.preferences(),
      ...draft,
      displayName: draft.displayName !== undefined ? normalizeText(draft.displayName) : this.preferences().displayName,
    };

    const errors = this.validate(merged);
    this.validationErrors.set(errors);
    this.savedMessage.set(null);
    if (errors.length > 0) {
      return false;
    }

    this.submitting.set(true);
    try {
      await this.db.set('preferences', merged);
      this.preferences.set(merged);
      this.applyTheme(merged.theme);
      this.savedMessage.set('Preferences saved on this device');
      return true;
    } catch {
      this.storageError.set('Could not save preferences to local browser storage.');
      return false;
    } finally {
      this.submitting.set(false);
    }
  }

  async completeOnboarding(displayName: string, movementFocus: MovementFocus): Promise<boolean> {
    return this.save({
      displayName,
      movementFocus,
      onboardingCompleted: true,
    });
  }

  async setWasmFallback(): Promise<void> {
    await this.save({ preferredBackend: 'WasmCpu' });
  }

  toggleTheme(): void {
    const next: ThemeMode = this.preferences().theme === 'dark' ? 'light' : 'dark';
    this.preferences.update((p) => ({ ...p, theme: next }));
    this.applyTheme(next);
    void this.db.set('preferences', this.preferences());
  }

  private applyTheme(theme: ThemeMode): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }
}
