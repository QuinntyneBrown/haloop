import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SystemStatusStore } from '../../core/state/system-status.store';

@Component({
  selector: 'app-offline-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="empty">
      <div class="empty__icon" aria-hidden="true">
        <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <h2 class="empty__title">You’re offline—Haloop still works</h2>
      <p class="empty__text">
        All {{ status.cachedModelCount() }} cached models ({{ status.cachedModelMb() }} MB) and Gemini Nano run right in
        this tab. Only downloading new models from Hugging Face needs a connection.
      </p>
      <div class="empty__actions">
        <a class="btn btn--primary btn--pill" routerLink="/train">Start a workout</a>
        <a class="btn btn--pill" routerLink="/coach">Open Coach</a>
      </div>
    </div>
  `,
})
export class OfflinePageComponent {
  protected readonly status = inject(SystemStatusStore);
}
