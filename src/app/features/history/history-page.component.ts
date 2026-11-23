import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SessionCategory, WorkoutHistoryStore } from '../../core/state/workout-history.store';

@Component({
  selector: 'app-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    @if (history.error(); as err) {
      <section class="empty" role="alert">
        <h2 class="empty__title">Could not load workout history</h2>
        <p class="empty__text">{{ err }}</p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="history.load()">Retry</button>
        </div>
      </section>
    } @else {
      <section class="card stack stack--sm">
        <div class="cluster cluster--between">
          <span class="overline">Weekly recap · Chrome Summarizer</span>
          <span class="text-caption">16–23 Nov 2026</span>
        </div>
        <p class="text-soft">{{ history.weeklyRecap() }}</p>
      </section>

      <div class="cluster cluster--between">
        <form class="search" role="search" style="flex:1; max-width:22rem;" (submit)="$event.preventDefault()">
          <label class="visually-hidden" for="hist-q">Search sessions</label>
          <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            class="input"
            id="hist-q"
            type="search"
            placeholder="Search workouts or notes"
            [ngModel]="history.searchQuery()"
            (ngModelChange)="history.searchQuery.set($event)"
            name="searchQuery"
            data-testid="history-search"
          />
        </form>
        <div class="cluster" role="group" aria-label="Filter sessions by category">
          @for (cat of categories; track cat) {
            <button
              class="chip"
              type="button"
              [attr.aria-pressed]="history.activeCategory() === cat"
              (click)="history.activeCategory.set(cat)"
              [attr.data-testid]="'history-filter-' + cat.toLowerCase()"
            >
              {{ cat === 'All' ? 'All (' + history.sessions().length + ')' : cat }}
            </button>
          }
        </div>
      </div>

      @if (history.sessions().length === 0) {
        <section class="empty">
          <h2 class="empty__title">No workouts recorded yet</h2>
          <p class="empty__text">
            Once you finish your first session, Haloop stores your reps, form score, and heart-rate summary right here
            on your device.
          </p>
          <div class="empty__actions">
            <a class="btn btn--primary btn--pill" routerLink="/train">Start your first session</a>
          </div>
        </section>
      } @else if (history.filteredSessions().length === 0) {
        <section class="empty" data-testid="history-no-results">
          <h2 class="empty__title">No sessions match “{{ history.searchQuery() }}”</h2>
          <p class="empty__text">
            Clear your search or switch back to all session types to view your {{ history.sessions().length }} recorded
            workouts.
          </p>
          <div class="empty__actions">
            <button
              type="button"
              class="btn btn--primary btn--pill"
              (click)="history.clearFilters()"
              data-testid="history-clear-filters"
            >
              Clear filters
            </button>
          </div>
        </section>
      } @else {
        <div class="table-wrap">
          <table class="table">
            <caption class="visually-hidden">Completed workout sessions</caption>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Date</th>
                <th scope="col" class="num">Duration</th>
                <th scope="col" class="num">Avg HR</th>
                <th scope="col" class="num">Form</th>
                <th scope="col"><span class="visually-hidden">Open</span></th>
              </tr>
            </thead>
            <tbody>
              @for (session of history.filteredSessions(); track session.id) {
                <tr>
                  <td>
                    <div class="list__title">
                      <a [routerLink]="['/history', session.id]">{{ session.title }}</a>
                    </div>
                    <div class="list__meta">{{ session.primaryMetricText }}</div>
                  </td>
                  <td>{{ session.dateLabel }}</td>
                  <td class="num">{{ session.durationMinutes }} min</td>
                  <td class="num">{{ session.avgHeartRateBpm }} bpm</td>
                  <td class="num"><span class="badge badge--success">{{ session.formScorePercent }}%</span></td>
                  <td class="row-actions">
                    <a class="btn btn--sm btn--ghost" [routerLink]="['/history', session.id]">View</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
})
export class HistoryPageComponent {
  protected readonly history = inject(WorkoutHistoryStore);
  protected readonly categories: readonly SessionCategory[] = ['All', 'Strength', 'Run', 'Mobility'];
}
