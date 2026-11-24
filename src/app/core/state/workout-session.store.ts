import { Injectable, signal } from '@angular/core';

export type WorkoutStage = 'running' | 'idle';

export interface PlannedMovement {
  readonly name: string;
  readonly targetReps: number;
  readonly prescription: string;
  /** Whether VitPose joint angles can count this movement's reps; otherwise reps are counted manually. */
  readonly tracked: boolean;
}

/** Morning Strength & Mobility: four movements, three sets each (L2-010, L2-011). */
export const MORNING_STRENGTH_PLAN: readonly PlannedMovement[] = [
  { name: 'Goblet squats', targetReps: 12, prescription: '3 × 12 reps', tracked: true },
  { name: 'Incline push-ups', targetReps: 10, prescription: '3 × 10 reps', tracked: false },
  { name: 'Split squats', targetReps: 10, prescription: '3 × 10 reps per leg', tracked: true },
  { name: 'Forearm plank hold', targetReps: 1, prescription: '3 × 30 s hold', tracked: false },
];

export const SETS_PER_MOVEMENT = 3;

/**
 * Whether a workout is in progress. A saved or discarded workout leaves the Train page idle
 * until the user starts the next one (L2-010).
 */
@Injectable({ providedIn: 'root' })
export class WorkoutSessionStore {
  readonly stage = signal<WorkoutStage>('running');
  /** Bumped on every fresh start so a mounted Train page knows to reset its counters. */
  readonly startToken = signal(0);

  start(): void {
    this.startToken.update((n) => n + 1);
    this.stage.set('running');
  }

  end(): void {
    this.stage.set('idle');
  }
}
