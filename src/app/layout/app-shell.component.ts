import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { PreferencesStore } from '../core/state/preferences.store';
import { SystemStatusStore } from '../core/state/system-status.store';

interface NavItem {
  readonly label: string;
  readonly route: string;
  readonly exact: boolean;
  readonly icon: 'today' | 'train' | 'coach' | 'history' | 'devices' | 'lab' | 'settings';
}

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Today',
  '/train': 'Train',
  '/coach': 'Coach',
  '/history': 'History',
  '/devices': 'Devices',
  '/lab': 'AI Lab',
  '/settings': 'Settings',
  '/offline': 'Offline mode',
  '/404': 'Page not found',
};

@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>

    <div class="app-shell">
      <aside class="app-sidebar" aria-label="Sidebar">
        <a class="app-sidebar__brand" routerLink="/" aria-label="Haloop home">
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

        <nav class="app-sidebar__nav" aria-label="Primary">
          @for (item of navItems; track item.route) {
            <a
              class="app-sidebar__link"
              [routerLink]="item.route"
              routerLinkActive="is-active"
              [routerLinkActiveOptions]="{ exact: item.exact }"
              #rla="routerLinkActive"
              [attr.aria-current]="rla.isActive ? 'page' : null"
            >
              @switch (item.icon) {
                @case ('today') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />
                  </svg>
                }
                @case ('train') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                }
                @case ('coach') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path
                      d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                    />
                  </svg>
                }
                @case ('history') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                }
                @case ('devices') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m7 7 10 10-5 5V2l5 5L7 17" />
                  </svg>
                }
                @case ('lab') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
                  </svg>
                }
                @case ('settings') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="3" />
                    <path
                      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                    />
                  </svg>
                }
              }
              {{ item.label }}
            </a>
          }
        </nav>

        <div class="app-sidebar__footer">
          <div class="app-sidebar__status">
            <span class="status-dot status-dot--live" aria-hidden="true"></span>
            <span>{{ status.linkedDeviceCount() }} devices linked</span>
          </div>
          <div class="app-sidebar__status">
            <span class="status-dot status-dot--halo" aria-hidden="true"></span>
            @if (status.isOnline()) {
              <span>Gemini Nano on-device</span>
            } @else {
              <span>Offline · {{ status.cachedModelCount() }} models cached</span>
            }
          </div>
        </div>
      </aside>

      <div class="app-main-col">
        <header class="app-topbar">
          <a class="app-topbar__logo" routerLink="/" aria-label="Haloop home">
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
          </a>
          <h1 class="app-topbar__title">{{ pageTitle() }}</h1>
          <div class="app-topbar__actions">
            <button
              type="button"
              class="btn btn--sm btn--ghost"
              (click)="prefs.toggleTheme()"
              [attr.aria-pressed]="prefs.preferences().theme === 'dark'"
              data-testid="theme-toggle"
            >
              {{ prefs.preferences().theme === 'dark' ? '☀ Light' : '☾ Dark' }}
            </button>
            <a class="topbar-circle-btn topbar-circle-btn--mobile-only" routerLink="/devices" aria-label="Devices">
              <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                <path d="m7 7 10 10-5 5V2l5 5L7 17" />
              </svg>
            </a>
            <a class="topbar-circle-btn topbar-circle-btn--mobile-only" routerLink="/lab" aria-label="AI Lab">
              <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
              </svg>
            </a>
          </div>
        </header>

        @if (status.activeBanner(); as banner) {
          <div
            class="banner"
            [class.banner--info]="banner.severity === 'info'"
            [class.banner--success]="banner.severity === 'success'"
            [class.banner--warning]="banner.severity === 'warning'"
            [class.banner--danger]="banner.severity === 'danger'"
            [class.banner--persistent]="banner.severity === 'persistent'"
            role="status"
            aria-live="polite"
            data-testid="system-banner"
          >
            <span>{{ banner.message }}</span>
            <div class="cluster">
              <a class="btn btn--sm btn--pill" [routerLink]="banner.actionRoute">{{ banner.actionLabel }}</a>
              @if (banner.dismissible) {
                <button
                  type="button"
                  class="btn btn--sm btn--ghost"
                  aria-label="Dismiss banner"
                  (click)="status.dismissBanner(banner.id)"
                >
                  <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              }
            </div>
          </div>
        }

        <main id="main" class="app-content">
          <router-outlet />
        </main>

        <nav class="phone-tabs" aria-label="Mobile tabs">
          @for (tab of mobileTabs; track tab.route) {
            <a
              class="phone-tabs__item"
              [routerLink]="tab.route"
              routerLinkActive="is-active"
              [routerLinkActiveOptions]="{ exact: tab.exact }"
              #mrla="routerLinkActive"
              [attr.aria-current]="mrla.isActive ? 'page' : null"
            >
              @switch (tab.icon) {
                @case ('today') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />
                  </svg>
                }
                @case ('train') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                }
                @case ('coach') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path
                      d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                    />
                  </svg>
                }
                @case ('history') {
                  <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                }
              }
              <span>{{ tab.label }}</span>
            </a>
          }
        </nav>
      </div>
    </div>
  `,
})
export class AppShellComponent {
  protected readonly router = inject(Router);
  protected readonly prefs = inject(PreferencesStore);
  protected readonly status = inject(SystemStatusStore);

  protected readonly navItems: readonly NavItem[] = [
    { label: 'Today', route: '/', exact: true, icon: 'today' },
    { label: 'Train', route: '/train', exact: false, icon: 'train' },
    { label: 'Coach', route: '/coach', exact: false, icon: 'coach' },
    { label: 'History', route: '/history', exact: false, icon: 'history' },
    { label: 'Devices', route: '/devices', exact: false, icon: 'devices' },
    { label: 'AI Lab', route: '/lab', exact: false, icon: 'lab' },
    { label: 'Settings', route: '/settings', exact: false, icon: 'settings' },
  ];

  protected readonly mobileTabs = this.navItems.slice(0, 4);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly pageTitle = computed(() => {
    const url = this.currentUrl().split('?')[0];
    if (url.startsWith('/history/')) {
      return 'Session detail';
    }
    return ROUTE_TITLES[url] ?? 'Haloop';
  });
}
