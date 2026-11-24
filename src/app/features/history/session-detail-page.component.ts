import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { WorkoutHistoryStore } from '../../core/state/workout-history.store';

@Component({
  selector: 'app-session-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (session(); as s) {
      <nav aria-label="Breadcrumb">
        <ol class="breadcrumb">
          <li><a routerLink="/history">History</a></li>
          <li aria-current="page">{{ s.title }}</li>
        </ol>
      </nav>

      <div class="cluster cluster--between">
        <div>
          <h2>{{ s.title }}</h2>
          <p class="text-muted">{{ s.timeWindowLabel }} · Recorded with {{ s.sensorsUsed }}</p>
        </div>
        <a class="btn btn--pill" routerLink="/train">
          <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          Repeat session
        </a>
      </div>

      <section class="kpi-grid">
        <div class="card stat">
          <span class="stat__label">Duration</span>
          <span class="stat__value">{{ s.durationMinutes }} min</span>
        </div>
        <div class="card stat">
          <span class="stat__label">Total reps</span>
          <span class="stat__value">{{ s.totalReps }}</span>
        </div>
        <div class="card stat">
          <span class="stat__label">Form score</span>
          <span class="stat__value">{{ s.formScorePercent }}%</span>
        </div>
        <div class="card stat">
          <span class="stat__label">Avg heart rate</span>
          <span class="stat__value">{{ s.avgHeartRateBpm > 0 ? s.avgHeartRateBpm + ' bpm' : '—' }}</span>
        </div>
      </section>

      <section class="card stack stack--sm">
        <span class="overline">On-device recap · Chrome Summarizer</span>
        <p class="text-soft">{{ s.recapText }}</p>
      </section>

      <section class="verse-card">
        <span class="overline">Devotional note</span>
        <p class="text-soft">“{{ s.devotionalNote }}”</p>
        <span class="verse-card__ref">{{ s.verseReference }}</span>
      </section>
    }
  `,
})
export class SessionDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly history = inject(WorkoutHistoryStore);

  protected readonly session = computed(() => {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    return this.history.getById(id);
  });

  constructor() {
    if (!this.session()) {
      void this.router.navigateByUrl('/404', { replaceUrl: true });
    }
  }
}
