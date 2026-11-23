import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BrowserCapabilityService } from '../../core/capabilities/browser-capability.service';
import { MovementFocus, PreferencesStore } from '../../core/state/preferences.store';
import { validateDisplayName } from '../../core/security/sanitize';

@Component({
  selector: 'app-onboarding-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>

    <div class="auth-layout">
      <main id="main" class="container container--narrow stack">
        <div style="display:flex; justify-content:center; margin-bottom: var(--space-2);">
          <a routerLink="/" class="topbar__brand" aria-label="Haloop home">
            <svg width="30" height="30" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <ellipse cx="32" cy="12" rx="14" ry="4.25" stroke="var(--color-halo)" stroke-width="4" />
              <circle
                cx="32"
                cy="39"
                r="17"
                stroke="currentColor"
                stroke-width="7.5"
                stroke-linecap="round"
                stroke-dasharray="88 18.8"
                transform="rotate(-38 32 39)"
              />
            </svg>
            <span>haloop</span>
          </a>
        </div>

        <ol class="stepper" aria-label="Setup progress">
          <li data-complete><span>Browser check</span></li>
          <li [attr.aria-current]="completed() ? null : 'step'" [attr.data-complete]="completed() ? '' : null">
            <span>Your rhythm</span>
          </li>
          <li [attr.aria-current]="completed() ? 'step' : null"><span>Ready</span></li>
        </ol>

        @if (completed()) {
          <section class="card stack" data-testid="onboarding-success">
            <h1>You’re ready, {{ firstName() }}</h1>
            <p class="text-muted">
              Gemini Nano is available in Chrome and on-device inference is active. Your first morning session and
              Scripture reflection are ready.
            </p>
            <div class="cluster">
              <a class="btn btn--primary btn--pill" routerLink="/">Open Today</a>
              <a class="btn btn--pill" routerLink="/lab">Review AI Lab</a>
            </div>
          </section>
        } @else {
          <form class="card stack" (ngSubmit)="onSubmit()" novalidate>
            <div>
              <h1>Welcome to Haloop</h1>
              <p class="text-muted" style="margin-top:var(--space-1);">
                Private, on-device movement coaching and daily Scripture—everything runs in this tab.
              </p>
            </div>

            @if (validationError()) {
              <div class="alert alert--danger" role="alert" data-testid="onboarding-error-summary">
                <strong>Check your details</strong>
                <p>Enter a display name to finish setting up Haloop.</p>
              </div>
            }

            <div class="well cluster cluster--between">
              <span class="inline-status inline-status--success">
                <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                Chrome Gemini Nano ready
              </span>
              <span class="inline-status inline-status--success">
                <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                {{ capabilities.report().webGpuAvailable ? 'WebGPU active' : 'WebAssembly CPU active' }}
              </span>
            </div>

            <label class="field">
              <span class="field__label">Your name</span>
              <input
                class="input"
                type="text"
                name="displayName"
                [ngModel]="displayName()"
                (ngModelChange)="displayName.set($event)"
                [attr.aria-invalid]="validationError() ? 'true' : null"
                data-testid="onboarding-name-input"
              />
              @if (validationError(); as err) {
                <span class="field__error" role="alert">{{ err }}</span>
              }
            </label>

            <fieldset class="stack stack--sm">
              <legend>Weekly movement focus</legend>
              <label class="choice">
                <input
                  type="radio"
                  name="goal"
                  value="StrengthMobility"
                  [checked]="movementFocus() === 'StrengthMobility'"
                  (change)="movementFocus.set('StrengthMobility')"
                />
                <span class="choice__text">
                  Strength &amp; mobility
                  <small>3–5 guided camera sessions per week</small>
                </span>
              </label>
              <label class="choice">
                <input
                  type="radio"
                  name="goal"
                  value="RunningEndurance"
                  [checked]="movementFocus() === 'RunningEndurance'"
                  (change)="movementFocus.set('RunningEndurance')"
                />
                <span class="choice__text">
                  Running &amp; endurance
                  <small>Tempo intervals with Bluetooth heart-rate zones</small>
                </span>
              </label>
              <label class="choice">
                <input
                  type="radio"
                  name="goal"
                  value="GentleDailyHabit"
                  [checked]="movementFocus() === 'GentleDailyHabit'"
                  (change)="movementFocus.set('GentleDailyHabit')"
                />
                <span class="choice__text">
                  Gentle daily habit
                  <small>15-minute stretch, walk, and devotional check-in</small>
                </span>
              </label>
            </fieldset>

            <div class="form-actions">
              <a class="btn btn--pill" routerLink="/">Skip for now</a>
              <button class="btn btn--primary btn--pill" type="submit" data-testid="onboarding-continue">
                Continue
              </button>
            </div>
          </form>
        }
      </main>
    </div>
  `,
})
export class OnboardingPageComponent {
  protected readonly capabilities = inject(BrowserCapabilityService);
  private readonly prefs = inject(PreferencesStore);
  private readonly router = inject(Router);

  protected readonly displayName = signal<string>(this.prefs.preferences().displayName);
  protected readonly movementFocus = signal<MovementFocus>(this.prefs.preferences().movementFocus);
  protected readonly validationError = signal<string | null>(null);
  protected readonly completed = signal<boolean>(false);

  protected firstName(): string {
    return this.displayName().trim().split(/\s+/)[0] || 'Friend';
  }

  protected async onSubmit(): Promise<void> {
    const err = validateDisplayName(this.displayName());
    this.validationError.set(err);
    if (err) {
      return;
    }
    const ok = await this.prefs.completeOnboarding(this.displayName(), this.movementFocus());
    if (ok) {
      this.completed.set(true);
    }
  }

  protected goToday(): void {
    void this.router.navigateByUrl('/');
  }
}
