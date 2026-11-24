import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrowserCapabilityService } from '../../core/capabilities/browser-capability.service';
import { ModelRegistryStore, OpenModelEntry } from '../../core/state/model-registry.store';
import { SystemStatusStore } from '../../core/state/system-status.store';

@Component({
  selector: 'app-ai-lab-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (!registry.loaded()) {
      <div class="stack" aria-busy="true" data-testid="ailab-loading">
        <div class="stack stack--sm" role="status" aria-label="Loading AI Lab">
          <span class="skeleton skeleton--text" style="width: 78%;"></span>
          <span class="skeleton skeleton--text" style="width: 52%;"></span>
        </div>
        <section class="stack">
          <div class="section-head">
            <h2>Built into Chrome</h2>
            <span class="text-sm text-muted">Checking Gemini Nano capabilities…</span>
          </div>
          <ul class="builtin-grid">
          <li class="builtin-row">
            <div class="stack stack--sm" style="flex:1;">
              <span class="skeleton skeleton--text" style="width:40%;"></span>
              <span class="skeleton skeleton--text" style="width:70%;"></span>
            </div>
            <span class="skeleton" style="width:4.5rem;height:1rem;"></span>
          </li>
          <li class="builtin-row">
            <div class="stack stack--sm" style="flex:1;">
              <span class="skeleton skeleton--text" style="width:40%;"></span>
              <span class="skeleton skeleton--text" style="width:70%;"></span>
            </div>
            <span class="skeleton" style="width:4.5rem;height:1rem;"></span>
          </li>
          <li class="builtin-row">
            <div class="stack stack--sm" style="flex:1;">
              <span class="skeleton skeleton--text" style="width:40%;"></span>
              <span class="skeleton skeleton--text" style="width:70%;"></span>
            </div>
            <span class="skeleton" style="width:4.5rem;height:1rem;"></span>
          </li>
          <li class="builtin-row">
            <div class="stack stack--sm" style="flex:1;">
              <span class="skeleton skeleton--text" style="width:40%;"></span>
              <span class="skeleton skeleton--text" style="width:70%;"></span>
            </div>
            <span class="skeleton" style="width:4.5rem;height:1rem;"></span>
          </li>
          </ul>
        </section>
        <section class="stack">
          <div class="section-head">
            <div>
              <h2>Open models</h2>
              <p class="text-sm text-muted">Inspecting local Cache Storage…</p>
            </div>
            <div class="budget-box"><span class="skeleton skeleton--text" style="width:100%;"></span></div>
          </div>
          <div class="model-list">
            @for (n of [1, 2, 3]; track n) {
              <div class="model-row">
                <div class="stack stack--sm">
                  <span class="skeleton skeleton--text" style="width:55%;"></span>
                  <span class="skeleton skeleton--text" style="width:80%;"></span>
                </div>
                <span class="skeleton skeleton--text" style="width:70%;"></span>
                <span class="skeleton skeleton--text" style="width:3rem;margin-left:auto;"></span>
                <span class="skeleton" style="width:6rem;height:2rem;border-radius:var(--radius-full);margin-left:auto;"></span>
              </div>
            }
          </div>
        </section>
      </div>
    } @else {
    @if (registry.storageError(); as storageError) {
      <div class="alert alert--danger" role="alert" data-testid="ailab-storage-error">
        <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        <div class="alert__body">
          <div class="alert__title">Could not read on-device model storage</div>
          <p class="text-sm">
            Your browser blocked Origin Private File System access in this window (common in private browsing or when
            disk quota is full). Built-in Chrome APIs remain available.
          </p>
          <p class="text-sm text-muted">{{ storageError }}</p>
          <div class="alert__actions">
            <button type="button" class="toast__action" (click)="registry.checkStorage()" data-testid="ailab-retry-check">
              Retry check
            </button>
            <a routerLink="/settings">Check storage settings</a>
          </div>
        </div>
      </div>
    }
    <p class="text-soft" style="font-size: var(--font-size-lg); line-height: var(--line-height-normal);">
      Every model Haloop uses runs in this tab. Chrome manages its built-in Gemini Nano; open models download once from
      Hugging Face and run on your {{ status.wasmFallbackActive() ? 'CPU via WebAssembly' : 'GPU via WebGPU' }}.
    </p>

    @if (status.wasmFallbackActive()) {
      <section class="alert alert--warning" role="status">
        <strong>Running on CPU via WebAssembly</strong>
        <p>WebGPU is unavailable in this browser session. Pose estimation and voice transcription still run locally.</p>
      </section>
    }

    <section>
      <div class="section-head">
        <h2>Built into Chrome</h2>
        <span class="text-sm text-muted">Gemini Nano · managed by the browser</span>
      </div>
      <ul class="builtin-grid">
        <li class="builtin-row">
          <div>
            <div class="builtin-row__title">Prompt API</div>
            <div class="builtin-row__desc">Coach conversations and live cues</div>
          </div>
          <span class="text-sm text-live">Available</span>
        </li>
        <li class="builtin-row">
          <div>
            <div class="builtin-row__title">Summarizer</div>
            <div class="builtin-row__desc">Session and weekly recaps</div>
          </div>
          <span class="text-sm text-live">Available</span>
        </li>
        <li class="builtin-row">
          <div>
            <div class="builtin-row__title">Writer &amp; Rewriter</div>
            <div class="builtin-row__desc">Devotional reflections</div>
          </div>
          @if (capabilities.report().writerFlagEnabled) {
            <span class="text-sm text-live">Available</span>
          } @else {
            <button
              type="button"
              class="btn btn--ghost btn--sm text-halo"
              (click)="flagsDialogOpen.set(true)"
              data-testid="ailab-writer-flag-btn"
            >
              Flag off
            </button>
          }
        </li>
        <li class="builtin-row">
          <div>
            <div class="builtin-row__title">Translator</div>
            <div class="builtin-row__desc">Scripture in 12 languages</div>
          </div>
          <span class="text-sm text-live">Available</span>
        </li>
      </ul>
    </section>

    <section>
      <div class="section-head" style="align-items:flex-end;">
        <div>
          <h2>Open models</h2>
          <p class="text-sm text-muted" style="margin-top:var(--space-1);">
            From Hugging Face, run with Transformers.js
          </p>
        </div>
        <div class="budget-box">
          <div class="budget-box__meta">
            <span>{{ registry.cachedMb() }} MB cached</span>
            <span>of {{ registry.budgetMb() }} MB budget</span>
          </div>
          <div
            class="budget-bar"
            role="progressbar"
            aria-label="Model cache budget"
            [attr.aria-valuenow]="registry.cachedMb()"
            aria-valuemin="0"
            [attr.aria-valuemax]="registry.budgetMb()"
          >
            <div class="budget-bar__fill" [style.--value.%]="registry.budgetPercent()"></div>
          </div>
        </div>
      </div>

      @if (noModelsCached() && !registry.storageError()) {
        <div class="card stack stack--sm" data-testid="ailab-empty">
          <div class="card__title">No open models cached yet</div>
          <p class="text-sm text-muted">
            Download any model below once from Hugging Face to run rep counting, voice commands, coach speech, or KJV
            verse search completely offline in this tab.
          </p>
        </div>
      }
      <div class="model-list">
        @for (m of registry.models(); track m.id) {
          <div class="model-row">
            <div style="min-width:0;">
              <div class="builtin-row__title">{{ m.title }}</div>
              <a
                class="model-row__repo"
                [href]="'https://huggingface.co/' + m.repoId"
                target="_blank"
                rel="noreferrer"
              >
                <span class="truncate">{{ m.repoId }}</span>
                <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24" style="width:0.75rem;height:0.75rem;">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
            <div class="model-row__task">{{ m.taskLabel }}</div>
            <div class="model-row__size">
              @if (m.state === 'downloading' || m.state === 'paused') {
                {{ m.downloadedMb }} / {{ m.sizeMb }} MB
              } @else {
                {{ m.sizeMb }} MB
              }
            </div>
            <div class="model-row__action">
              @if (m.state === 'ready') {
                <span class="inline-status inline-status--success">
                  <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                  <span>Ready</span>
                </span>
                <button
                  type="button"
                  class="btn btn--ghost btn--icon btn--sm"
                  [attr.aria-label]="'Remove ' + m.title + ' model'"
                  (click)="openRemove(m)"
                  [attr.data-testid]="'ailab-remove-' + m.id"
                >
                  <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              } @else if (m.state === 'downloading') {
                <span class="badge">Downloading…</span>
              } @else if (m.state === 'paused') {
                <span class="badge" data-testid="ailab-paused-badge">Paused</span>
                <button
                  type="button"
                  class="btn btn--sm btn--pill"
                  (click)="registry.downloadModel(m.id)"
                  [attr.data-testid]="'ailab-resume-' + m.id"
                >
                  Resume
                </button>
              } @else {
                <button
                  type="button"
                  class="btn btn--sm btn--pill"
                  (click)="registry.downloadModel(m.id)"
                  [attr.data-testid]="'ailab-download-' + m.id"
                >
                  <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download
                </button>
              }
            </div>
          </div>
        }
      </div>
    </section>
    }

    @if (flagsDialogOpen()) {
      <div class="backdrop" (click)="flagsDialogOpen.set(false)"></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flags-dlg-title"
        (keydown.escape)="flagsDialogOpen.set(false)"
        data-testid="chrome-flags-dialog"
      >
        <div class="dialog__panel">
          <div class="dialog__header">
            <div class="dialog__icon dialog__icon--info" aria-hidden="true">
              <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
              </svg>
            </div>
            <div style="flex:1;">
              <h2 class="dialog__title" id="flags-dlg-title">Enable Writer &amp; Rewriter</h2>
              <p class="text-sm text-muted" style="margin-top:var(--space-1);">
                This Gemini Nano API powers tailored devotional reflections in Coach.
              </p>
            </div>
            <button
              type="button"
              class="btn btn--ghost btn--icon btn--sm"
              aria-label="Close dialog"
              (click)="flagsDialogOpen.set(false)"
            >
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="dialog__body stack">
            <ol class="stack stack--sm" style="padding-left:var(--space-5); margin:0;">
              <li>Open <code>chrome://flags/#writer-api-for-gemini-nano</code> in a new tab.</li>
              <li>Switch the flag from <strong>Default</strong> to <strong>Enabled</strong>.</li>
              <li>Relaunch Chrome, then return here to verify Writer &amp; Rewriter.</li>
            </ol>
            @if (flagsRecheckMessage(); as message) {
              <div class="alert alert--warning" role="status" data-testid="chrome-flags-result">
                <div class="alert__body">
                  <div class="alert__title">Writer &amp; Rewriter still not detected</div>
                  <p class="text-sm">{{ message }}</p>
                </div>
              </div>
            }
          </div>
          <div class="dialog__footer">
            <button type="button" class="btn btn--pill" (click)="flagsDialogOpen.set(false)">Close</button>
            <button
              type="button"
              class="btn btn--primary btn--pill"
              (click)="recheckFlags()"
              [disabled]="recheckingFlags()"
              data-testid="chrome-flags-recheck"
            >
              {{ recheckingFlags() ? 'Checking…' : 'Re-check Chrome flags' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (pendingRemoval(); as target) {
      <div class="backdrop" (click)="closeRemove()"></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rm-dlg-title"
        (keydown.escape)="closeRemove()"
        data-testid="remove-model-dialog"
      >
        <div class="dialog__panel">
          <div class="dialog__header">
            <div class="dialog__icon dialog__icon--danger" aria-hidden="true">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <div style="flex:1;">
              <h2 class="dialog__title" id="rm-dlg-title">Remove “{{ target.title }}”?</h2>
              <p class="text-sm text-muted" style="margin-top:var(--space-1);">
                This feature will pause until the model is downloaded again.
              </p>
            </div>
            <button
              type="button"
              class="btn btn--ghost btn--icon btn--sm"
              aria-label="Close dialog"
              (click)="closeRemove()"
            >
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div class="dialog__body stack">
            @if (removeError(); as failure) {
              <div class="alert alert--danger" role="alert" data-testid="remove-model-error">
                <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                <div class="alert__body">
                  <div class="alert__title">Could not delete model cache</div>
                  <p class="text-sm">{{ failure }}</p>
                </div>
              </div>
            }
            <p class="text-sm text-muted">
              Repository: <code>{{ target.repoId }}</code> · {{ target.sizeMb }} MB will be freed from your browser
              cache. You can re-download it anytime from Hugging Face.
            </p>
          </div>
          <div class="dialog__footer">
            <button type="button" class="btn btn--pill" (click)="closeRemove()">Cancel</button>
            <button
              type="button"
              class="btn btn--danger btn--pill"
              (click)="confirmRemove(target.id)"
              [disabled]="removing()"
              data-testid="remove-model-confirm"
            >
              {{ removing() ? 'Removing…' : removeError() ? 'Retry remove' : 'Remove ' + target.sizeMb + ' MB' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (registry.toasts().length > 0) {
      <div class="toast-region" aria-live="polite" data-testid="model-toast-region">
        @for (t of registry.toasts(); track t.id) {
          <div
            class="toast"
            [class.toast--info]="t.severity === 'info'"
            [class.toast--success]="t.severity === 'success'"
            [class.toast--warning]="t.severity === 'warning'"
            [class.toast--danger]="t.severity === 'danger'"
            role="status"
          >
            <div class="toast__icon" aria-hidden="true">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                @if (t.severity === 'success') {
                  <path d="M20 6 9 17l-5-5" />
                } @else {
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                }
              </svg>
            </div>
            <div class="toast__body">
              <div class="toast__title">{{ t.title }}</div>
              <div class="toast__text">{{ t.message }}</div>
            </div>
            <button
              type="button"
              class="btn btn--ghost btn--icon btn--sm"
              aria-label="Dismiss notification"
              (click)="registry.dismissToast(t.id)"
            >
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class AiLabPageComponent {
  protected readonly capabilities = inject(BrowserCapabilityService);
  protected readonly registry = inject(ModelRegistryStore);
  protected readonly status = inject(SystemStatusStore);

  protected readonly flagsDialogOpen = signal<boolean>(false);
  protected readonly recheckingFlags = signal<boolean>(false);
  protected readonly pendingRemoval = signal<OpenModelEntry | null>(null);
  protected readonly removing = signal<boolean>(false);

  protected readonly removeError = signal<string | null>(null);
  protected readonly flagsRecheckMessage = signal<string | null>(null);
  protected readonly noModelsCached = computed(() =>
    this.registry.models().every((m) => m.state === 'not-downloaded'),
  );

  /** Re-probes the real Chrome Built-in AI APIs; the dialog only closes once Writer & Rewriter is detected. */
  protected async recheckFlags(): Promise<void> {
    this.recheckingFlags.set(true);
    this.flagsRecheckMessage.set(null);
    try {
      const report = await this.capabilities.recheck();
      if (report.writerFlagEnabled) {
        this.flagsDialogOpen.set(false);
      } else {
        this.flagsRecheckMessage.set(
          'Chrome still reports the Writer API as unavailable. Enable the flag, relaunch Chrome, then check again.',
        );
      }
    } finally {
      this.recheckingFlags.set(false);
    }
  }

  protected openRemove(model: OpenModelEntry): void {
    this.removeError.set(null);
    this.pendingRemoval.set(model);
  }

  protected closeRemove(): void {
    this.removeError.set(null);
    this.pendingRemoval.set(null);
  }

  /** A failed deletion keeps the dialog open with an actionable error instead of closing silently. */
  protected async confirmRemove(id: string): Promise<void> {
    this.removing.set(true);
    this.removeError.set(null);
    try {
      const result = await this.registry.removeModel(id);
      if (result.ok) {
        this.closeRemove();
      } else {
        this.removeError.set(
          `${result.reason ?? 'The cached files could not be deleted.'} Close any Train tab using this model, then retry.`,
        );
      }
    } finally {
      this.removing.set(false);
    }
  }
}
