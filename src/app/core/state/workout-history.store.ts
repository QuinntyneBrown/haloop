import { Injectable, computed, inject, signal } from '@angular/core';
import { HaloopDbService } from '../storage/haloop-db.service';

export type SessionCategory = 'All' | 'Strength' | 'Run' | 'Mobility';

export interface WorkoutSessionRecord {
  readonly id: string;
  readonly title: string;
  readonly category: Exclude<SessionCategory, 'All'>;
  readonly dateLabel: string;
  readonly timeWindowLabel: string;
  readonly sensorsUsed: string;
  readonly durationMinutes: number;
  readonly totalReps: number;
  readonly primaryMetricText: string;
  readonly avgHeartRateBpm: number;
  readonly formScorePercent: number;
  readonly recapText: string;
  readonly devotionalNote: string;
  readonly verseReference: string;
}

const SEED_SESSIONS: readonly WorkoutSessionRecord[] = [
  {
    id: 'upper-body-core-2026-11-21',
    title: 'Upper Body & Core',
    category: 'Strength',
    dateLabel: 'Sat 21 Nov',
    timeWindowLabel: 'Saturday, 21 Nov 2026 · 07:18–07:46 EST',
    sensorsUsed: 'Polar H10 & VitPose',
    durationMinutes: 28,
    totalReps: 124,
    primaryMetricText: '124 reps · Polar H10',
    avgHeartRateBpm: 138,
    formScorePercent: 94,
    recapText:
      'Strong shoulder stability across all three push-up sets; minor elbow flare appeared only on reps 9–10 of set 3. Heart rate recovered by 24 bpm within 60 seconds after the final plank.',
    devotionalNote:
      'Grateful for steady energy this morning. Keeping the pace unhurried made the final set much cleaner.',
    verseReference: '1 Corinthians 9:24 · KJV',
  },
  {
    id: 'tempo-run-mobility-2026-11-19',
    title: 'Tempo Run & Mobility',
    category: 'Run',
    dateLabel: 'Thu 19 Nov',
    timeWindowLabel: 'Thursday, 19 Nov 2026 · 06:50–07:24 EST',
    sensorsUsed: 'Coros Pace 3',
    durationMinutes: 34,
    totalReps: 0,
    primaryMetricText: '5.2 km · Coros Pace 3',
    avgHeartRateBpm: 149,
    formScorePercent: 91,
    recapText:
      'Consistent 174 spm running cadence across middle tempo kilometers with smooth cool-down ankle mobility.',
    devotionalNote: 'Focused on steady breathing during the final kilometer.',
    verseReference: 'Hebrews 12:1 · KJV',
  },
  {
    id: 'lower-body-strength-2026-11-17',
    title: 'Lower Body Strength',
    category: 'Strength',
    dateLabel: 'Tue 17 Nov',
    timeWindowLabel: 'Tuesday, 17 Nov 2026 · 07:10–07:41 EST',
    sensorsUsed: 'Polar H10 & VitPose',
    durationMinutes: 31,
    totalReps: 112,
    primaryMetricText: '112 reps · Polar H10',
    avgHeartRateBpm: 132,
    formScorePercent: 96,
    recapText:
      'Goblet squat depth consistency improved 3% over the prior week with balanced knee tracking across split squats.',
    devotionalNote: 'Patience in the eccentric tempo paid off on the last set.',
    verseReference: 'Isaiah 40:31 · KJV',
  },
  {
    id: 'sabbath-stretch-walk-2026-11-15',
    title: 'Sabbath Stretch & Walk',
    category: 'Mobility',
    dateLabel: 'Sun 15 Nov',
    timeWindowLabel: 'Sunday, 15 Nov 2026 · 08:05–08:25 EST',
    sensorsUsed: 'Coros Pace 3',
    durationMinutes: 20,
    totalReps: 0,
    primaryMetricText: '2.4 km · Coros Pace 3',
    avgHeartRateBpm: 102,
    formScorePercent: 98,
    recapText:
      'Restorative Zone 1 walk paired with gentle thoracic and hip mobility.',
    devotionalNote: 'Quiet gratitude walk before church.',
    verseReference: 'Psalm 23:1-3 · KJV',
  },
];

@Injectable({ providedIn: 'root' })
export class WorkoutHistoryStore {
  private readonly db = inject(HaloopDbService);

  readonly sessions = signal<readonly WorkoutSessionRecord[]>(SEED_SESSIONS);
  readonly searchQuery = signal<string>('');
  readonly activeCategory = signal<SessionCategory>('All');
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly filteredSessions = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const cat = this.activeCategory();
    return this.sessions().filter((s) => {
      const catMatch = cat === 'All' || s.category === cat;
      const qMatch =
        q.length === 0 ||
        s.title.toLowerCase().includes(q) ||
        s.devotionalNote.toLowerCase().includes(q) ||
        s.primaryMetricText.toLowerCase().includes(q);
      return catMatch && qMatch;
    });
  });

  readonly totalActiveMinutes = computed(() =>
    this.sessions().reduce((sum, s) => sum + s.durationMinutes, 0),
  );

  readonly avgFormScore = computed(() => {
    const list = this.sessions();
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, s) => sum + s.formScorePercent, 0) / list.length);
  });

  readonly weeklyRecap = computed(() => {
    const list = this.sessions();
    return `${list.length} sessions completed (${this.totalActiveMinutes()} active minutes). Average form score held at ${this.avgFormScore()}%, and average heart rate stayed comfortably in Zone 2–3 across strength days.`;
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const stored = await this.db.get<WorkoutSessionRecord[]>('sessions');
      if (stored && stored.length > 0) {
        this.sessions.set(stored);
      }
    } catch {
      this.error.set('Local storage is temporarily locked by another Haloop tab. Close duplicate tabs and retry.');
    } finally {
      this.loading.set(false);
    }
  }

  getById(id: string): WorkoutSessionRecord | null {
    return this.sessions().find((s) => s.id === id) ?? null;
  }

  async addSession(record: WorkoutSessionRecord): Promise<void> {
    const updated = [record, ...this.sessions()];
    await this.db.set('sessions', updated);
    this.sessions.set(updated);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.activeCategory.set('All');
  }
}
