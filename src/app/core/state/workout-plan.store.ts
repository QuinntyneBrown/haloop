import { Injectable, computed, signal } from '@angular/core';

/** A structured change the Coach asks the active workout plan to apply (L2-012, L2-013). */
export interface WorkoutAdjustment {
  readonly loadChangePercent: number;
  readonly warmUp: { readonly label: string; readonly durationSeconds: number };
  readonly source: 'coach';
}

/** The light-load warm-up Coach recommends for tight calves: -20% load and 90 s of ankle rocks. */
export const LIGHT_LOAD_WARM_UP: WorkoutAdjustment = {
  loadChangePercent: -20,
  warmUp: { label: 'Slow ankle rocks', durationSeconds: 90 },
  source: 'coach',
};

/** Active workout plan state shared between Coach and Train. Held in memory only; nothing leaves the browser. */
@Injectable({ providedIn: 'root' })
export class WorkoutPlanStore {
  private readonly current = signal<WorkoutAdjustment | null>(null);

  readonly adjustment = this.current.asReadonly();
  readonly loadLabel = computed(() => {
    const a = this.current();
    return a ? `${a.loadChangePercent > 0 ? '+' : '−'}${Math.abs(a.loadChangePercent)}% load` : null;
  });

  apply(adjustment: WorkoutAdjustment): void {
    this.current.set(adjustment);
  }

  clear(): void {
    this.current.set(null);
  }
}
