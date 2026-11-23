import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  InferenceBackend,
  PreferencesStore,
  SUPPORTED_SCRIPTURE_LANGUAGES,
} from '../../core/state/preferences.store';
import { SystemStatusStore } from '../../core/state/system-status.store';

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    @if (prefs.storageError(); as err) {
      <section class="empty" role="alert">
        <h2 class="empty__title">Could not load local preferences</h2>
        <p class="empty__text">{{ err }}</p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="prefs.load()">Reload settings</button>
        </div>
      </section>
    } @else {
      <form class="stack" (ngSubmit)="onSubmit()" novalidate>
        @if (prefs.validationErrors().length > 0) {
          <div class="alert alert--danger" role="alert" data-testid="settings-error-summary">
            <strong>Fix {{ prefs.validationErrors().length }} field before saving</strong>
            <ul>
              @for (e of prefs.validationErrors(); track e.field) {
                <li>{{ e.message }}</li>
              }
            </ul>
          </div>
        }

        @if (prefs.savedMessage(); as msg) {
          <div class="alert alert--success" role="status" aria-live="polite" data-testid="settings-success">
            <strong>{{ msg }}</strong>
            <p>Your updated units, Scripture language, and cache budget apply immediately.</p>
          </div>
        }

        <section class="card stack">
          <h2>Profile &amp; Scripture</h2>
          <label class="field">
            <span class="field__label">Display name</span>
            <input
              class="input"
              type="text"
              name="displayName"
              [ngModel]="displayName()"
              (ngModelChange)="displayName.set($event)"
              data-testid="settings-display-name"
            />
            @if (fieldError('displayName'); as err) {
              <span class="field__error" role="alert">{{ err }}</span>
            }
          </label>

          <label class="field">
            <span class="field__label">Scripture language</span>
            <select
              class="select"
              name="scriptureLanguage"
              [ngModel]="scriptureLanguage()"
              (ngModelChange)="scriptureLanguage.set($event)"
              data-testid="settings-language"
            >
              @for (lang of languages; track lang.code) {
                <option [value]="lang.code">{{ lang.label }}</option>
              }
            </select>
            <span class="field__help">Translations run locally using Chrome’s built-in Translator API.</span>
          </label>
        </section>

        <section class="card stack">
          <h2>On-device compute &amp; storage</h2>
          <label class="field">
            <span class="field__label">Preferred inference backend</span>
            <select
              class="select"
              name="preferredBackend"
              [ngModel]="preferredBackend()"
              (ngModelChange)="preferredBackend.set($event)"
              data-testid="settings-backend"
            >
              <option value="AutoWebGpu">Automatic (WebGPU when available)</option>
              <option value="WasmCpu">WebAssembly (CPU only)</option>
            </select>
          </label>

          <label class="field">
            <span class="field__label">Model cache budget (MB)</span>
            <input
              class="input"
              id="cache-budget"
              type="number"
              name="cacheBudgetMb"
              [ngModel]="cacheBudgetMb()"
              (ngModelChange)="cacheBudgetMb.set(+$event)"
              [attr.aria-invalid]="fieldError('cacheBudgetMb') ? 'true' : null"
              data-testid="settings-cache-budget"
            />
            @if (fieldError('cacheBudgetMb'); as err) {
              <span class="field__error" role="alert" data-testid="settings-budget-error">{{ err }}</span>
            }
            <span class="field__help">
              Currently using {{ status.cachedModelMb() }} MB across {{ status.cachedModelCount() }} cached Hugging Face
              models.
            </span>
          </label>

          <label class="switch">
            <input
              type="checkbox"
              name="kokoroTtsEnabled"
              [ngModel]="kokoroTtsEnabled()"
              (ngModelChange)="kokoroTtsEnabled.set($event)"
            />
            <span>Speak live form cues with Kokoro TTS during workouts</span>
          </label>
        </section>

        <div class="form-actions">
          <a class="btn btn--pill" routerLink="/">Cancel</a>
          <button
            class="btn btn--primary btn--pill"
            type="submit"
            [disabled]="prefs.submitting()"
            data-testid="settings-save"
          >
            {{ prefs.submitting() ? 'Saving…' : 'Save preferences' }}
          </button>
        </div>
      </form>
    }
  `,
})
export class SettingsPageComponent {
  protected readonly prefs = inject(PreferencesStore);
  protected readonly status = inject(SystemStatusStore);
  protected readonly languages = SUPPORTED_SCRIPTURE_LANGUAGES;

  protected readonly displayName = signal<string>(this.prefs.preferences().displayName);
  protected readonly scriptureLanguage = signal<string>(this.prefs.preferences().scriptureLanguage);
  protected readonly preferredBackend = signal<InferenceBackend>(this.prefs.preferences().preferredBackend);
  protected readonly cacheBudgetMb = signal<number>(this.prefs.preferences().cacheBudgetMb);
  protected readonly kokoroTtsEnabled = signal<boolean>(this.prefs.preferences().kokoroTtsEnabled);

  protected fieldError(field: string): string | null {
    return this.prefs.validationErrors().find((e) => e.field === field)?.message ?? null;
  }

  protected async onSubmit(): Promise<void> {
    await this.prefs.save({
      displayName: this.displayName(),
      scriptureLanguage: this.scriptureLanguage(),
      preferredBackend: this.preferredBackend(),
      cacheBudgetMb: this.cacheBudgetMb(),
      kokoroTtsEnabled: this.kokoroTtsEnabled(),
    });
  }
}
