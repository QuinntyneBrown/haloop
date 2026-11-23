import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ScriptureService } from '../../core/scripture/scripture.service';
import { PreferencesStore } from '../../core/state/preferences.store';
import { WorkoutHistoryStore } from '../../core/state/workout-history.store';

@Component({
  selector: 'app-today-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (history.error(); as err) {
      <section class="empty" role="alert">
        <h2 class="empty__title">Could not load today’s local summary</h2>
        <p class="empty__text">
          {{ err }} Your cached models and workout studio are still available.
        </p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="history.load()">Retry</button>
          <a class="btn btn--pill" routerLink="/train">Open Train anyway</a>
        </div>
      </section>
    } @else {
      <div class="cluster cluster--between">
        <div>
          <p class="overline">Monday, 23 November 2026</p>
          <p class="text-muted" style="margin-top:var(--space-1);">
            Good morning, {{ firstName() }} · 11-day streak · Polar H10 ready (72 bpm)
          </p>
        </div>
        <a class="btn btn--primary btn--pill" routerLink="/train" data-testid="today-start-session">
          <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          Start morning session
        </a>
      </div>

      <section class="verse-card" aria-labelledby="verse-heading">
        <div class="cluster cluster--between">
          <h2 id="verse-heading" class="overline">Today’s Scripture</h2>
          <a class="text-sm" routerLink="/coach">Reflect with Coach</a>
        </div>
        <blockquote class="verse-card__quote">“{{ dailyVerse().text }}”</blockquote>
        <div class="cluster cluster--between">
          <span class="verse-card__ref">{{ dailyVerse().reference }}</span>
          <span class="text-caption">Translated on-device in 12 languages</span>
        </div>
      </section>

      <section class="stack">
        <div class="section-head">
          <h2>Today’s movement</h2>
          <span class="text-sm text-muted">25 min · Strength &amp; mobility</span>
        </div>
        <div class="card stack">
          <div class="cluster cluster--between">
            <div>
              <div class="card__title">Morning Strength &amp; Mobility</div>
              <p class="text-sm text-muted">
                4 movements · camera rep counting with VitPose · Kokoro voice cues
                {{ prefs.preferences().kokoroTtsEnabled ? 'on' : 'off' }}
              </p>
            </div>
            <span class="badge badge--success">Ready on-device</span>
          </div>
          <ul class="list">
            <li class="list__item">
              <div class="list__body">
                <div class="list__title">Goblet squats</div>
                <div class="list__meta">3 sets × 12 reps · Tempo 3-1-1</div>
              </div>
              <span class="text-sm text-muted tabular">6 min</span>
            </li>
            <li class="list__item">
              <div class="list__body">
                <div class="list__title">Incline push-ups</div>
                <div class="list__meta">3 sets × 10 reps · Form check on elbows</div>
              </div>
              <span class="text-sm text-muted tabular">5 min</span>
            </li>
            <li class="list__item">
              <div class="list__body">
                <div class="list__title">Split squats</div>
                <div class="list__meta">3 sets × 8 per side</div>
              </div>
              <span class="text-sm text-muted tabular">7 min</span>
            </li>
            <li class="list__item">
              <div class="list__body">
                <div class="list__title">Forearm plank hold</div>
                <div class="list__meta">3 × 45 sec · Guided breath prayer</div>
              </div>
              <span class="text-sm text-muted tabular">4 min</span>
            </li>
          </ul>
        </div>
      </section>

      <section class="stack">
        <h2>This week at a glance</h2>
        <div class="kpi-grid">
          <div class="card stat">
            <span class="stat__label">Sessions</span>
            <span class="stat__value">{{ history.sessions().length }} / 5</span>
            <span class="stat__delta stat__delta--up">↑ 1 vs last week</span>
          </div>
          <div class="card stat">
            <span class="stat__label">Avg form score</span>
            <span class="stat__value">{{ history.avgFormScore() }}%</span>
            <span class="stat__delta stat__delta--up">↑ 3% steady depth</span>
          </div>
          <div class="card stat">
            <span class="stat__label">Active minutes</span>
            <span class="stat__value">{{ history.totalActiveMinutes() }}</span>
            <span class="stat__delta text-muted">Goal: 150 min</span>
          </div>
          <div class="card stat">
            <span class="stat__label">Resting HR</span>
            <span class="stat__value">61 bpm</span>
            <span class="stat__delta text-muted">Polar H10 · 07:12</span>
          </div>
        </div>
      </section>
    }
  `,
})
export class TodayPageComponent {
  protected readonly prefs = inject(PreferencesStore);
  protected readonly history = inject(WorkoutHistoryStore);
  private readonly scripture = inject(ScriptureService);

  protected readonly firstName = computed(
    () => this.prefs.preferences().displayName.trim().split(/\s+/)[0] || 'Micah',
  );

  protected readonly dailyVerse = computed(() =>
    this.scripture.getDailyVerse(this.prefs.preferences().scriptureLanguage),
  );
}
