import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PreferencesStore } from '../../core/state/preferences.store';

@Component({
  selector: 'app-unsupported-browser-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
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
        <div class="card stack">
          <h1>Chrome is recommended for Haloop</h1>
          <p class="text-soft">
            This browser does not expose WebGPU, Web Bluetooth, or Chrome’s built-in Gemini Nano APIs. You can still
            use Haloop in CPU WebAssembly mode without Bluetooth sensors, or switch to Chrome 138+ for the full
            on-device experience.
          </p>
          <div class="well stack stack--sm">
            <div class="inline-status inline-status--danger">
              <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Built-in Gemini Nano: Unavailable
            </div>
            <div class="inline-status inline-status--danger">
              <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Web Bluetooth: Unavailable
            </div>
            <div class="inline-status inline-status--success">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
              WebAssembly CPU fallback: Available
            </div>
          </div>
          <div class="cluster">
            <button type="button" class="btn btn--primary btn--pill" (click)="continueInWasm()">
              Continue in WASM mode
            </button>
            <a class="btn btn--pill" routerLink="/">Back to Today</a>
          </div>
        </div>
      </main>
    </div>
  `,
})
export class UnsupportedBrowserPageComponent {
  private readonly prefs = inject(PreferencesStore);
  private readonly router = inject(Router);

  protected async continueInWasm(): Promise<void> {
    await this.prefs.setWasmFallback();
    await this.router.navigateByUrl('/lab');
  }
}
