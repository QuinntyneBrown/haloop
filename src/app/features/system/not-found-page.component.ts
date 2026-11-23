import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="empty">
      <div class="empty__icon" aria-hidden="true">
        <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <h2 class="empty__title">We couldn’t find that page</h2>
      <p class="empty__text">The link may be outdated or the workout record was removed from this device.</p>
      <div class="empty__actions">
        <a class="btn btn--primary btn--pill" routerLink="/">Go to Today</a>
        <a class="btn btn--pill" routerLink="/history">View History</a>
      </div>
    </div>
  `,
})
export class NotFoundPageComponent {}
