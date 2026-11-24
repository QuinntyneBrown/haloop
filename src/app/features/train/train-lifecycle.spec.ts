// Acceptance Test
// Traces to: L2-010, L2-011, L2-026
// Description: Verify the Train workout lifecycle: model warm-up loading state, idle empty state, progression
// through every planned movement and set, and QuotaExceededError handling in the Finish workout dialog.

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MlWorkerClient } from '../../core/ai/ml-worker.client';
import { WorkoutHistoryStore } from '../../core/state/workout-history.store';
import { MORNING_STRENGTH_PLAN, SETS_PER_MOVEMENT, WorkoutSessionStore } from '../../core/state/workout-session.store';
import { TrainPageComponent } from './train-page.component';
import { settleTrain } from './train-testing';

function text(host: HTMLElement, testId: string): string {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
}

describe('Train lifecycle', () => {
  let releaseWarmUp: (ok: boolean) => void;

  function setup(warmUp: () => Promise<boolean> = async () => true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'history/:id', children: [] }]),
        {
          provide: MlWorkerClient,
          useValue: {
            warmUp,
            disposePose: async () => undefined,
            synthesizeCue: async () => ({ samples: null }),
            stepPose: async (current: number, target: number) => ({
              completedReps: Math.min(target, current + 1),
              formScorePercent: 95,
              cue: 'ok',
              backend: 'WebGPU',
            }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(TrainPageComponent);
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('shows the loading skeleton while the models warm up, then the workout (L2-010)', async () => {
    const { fixture, host } = setup(() => new Promise<boolean>((resolve) => (releaseWarmUp = resolve)));
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="train-loading"]')).not.toBeNull();
    expect(host.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid="train-log-rep"]')).toBeNull();

    releaseWarmUp(true);
    await settleTrain(fixture);
    expect(host.querySelector('[data-testid="train-log-rep"]')).not.toBeNull();
  });

  it('leaves the loading state even when no worker exists (L2-010)', async () => {
    const { fixture, host } = setup(async () => false);
    await settleTrain(fixture);
    expect(host.querySelector('[data-testid="train-loading"]')).toBeNull();
  });

  it('shows the empty state when idle and starts a fresh workout from it (L2-010)', async () => {
    TestBed.configureTestingModule({});
    const { fixture, host } = setup();
    TestBed.inject(WorkoutSessionStore).end();
    await settleTrain(fixture);

    expect(host.querySelector('[data-testid="train-empty"]')).not.toBeNull();
    expect(host.textContent).toContain('Ready to train on-device');
    expect(host.textContent).toContain('Ask Coach for a plan');
    expect(host.querySelector('[data-testid="train-log-rep"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[data-testid="train-start-workout"]')!.click();
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="train-empty"]')).toBeNull();
    });
    expect(text(host, 'train-reps')).toContain('0 / 12');
    expect(text(host, 'train-movement')).toBe('Goblet squats');
    expect(host.textContent).toContain('Set 1 of 3');
  });

  it('advances through all four movements and every set, updating Up next (L2-011)', async () => {
    const { fixture, host } = setup();
    await settleTrain(fixture);
    expect(text(host, 'train-movement')).toBe('Goblet squats');
    expect(text(host, 'train-up-next')).toBe('Incline push-ups');
    expect(host.textContent).toContain('Set 2 of 3');

    const next = () => {
      host.querySelector<HTMLButtonElement>('[data-testid="train-next-set"]')!.click();
      fixture.detectChanges();
    };

    next(); // set 3
    expect(host.textContent).toContain('Set 3 of 3');
    next(); // movement 2
    expect(text(host, 'train-movement')).toBe('Incline push-ups');
    expect(text(host, 'train-reps')).toContain('0 / 10');
    expect(text(host, 'train-up-next')).toBe('Split squats');
    expect(host.textContent).toContain('Set 1 of 3');

    for (let i = 0; i < SETS_PER_MOVEMENT; i++) next();
    expect(text(host, 'train-movement')).toBe('Split squats');
    expect(text(host, 'train-up-next')).toBe('Forearm plank hold');

    for (let i = 0; i < SETS_PER_MOVEMENT; i++) next();
    expect(text(host, 'train-movement')).toBe('Forearm plank hold');
    expect(text(host, 'train-up-next')).toBe('Cool-down');
    expect(MORNING_STRENGTH_PLAN.map((m) => m.name)).toEqual([
      'Goblet squats',
      'Incline push-ups',
      'Split squats',
      'Forearm plank hold',
    ]);

    // The last set offers to finish instead of advancing.
    next();
    next();
    expect(text(host, 'train-next-set')).toBe('Finish workout');
    next();
    expect(host.querySelector('[data-testid="end-workout-dialog"]')).not.toBeNull();
  });

  it('keeps completed reps in the session total as sets advance (L2-011)', async () => {
    const { fixture, host } = setup();
    await settleTrain(fixture);
    host.querySelector<HTMLButtonElement>('[data-testid="train-log-rep"]')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text(host, 'train-reps')).toContain('9 / 12');
    });
    host.querySelector<HTMLButtonElement>('[data-testid="train-next-set"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="train-finish"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="end-workout-dialog"]')!.textContent).toContain('33');
  });

  it('shows Could not save session on QuotaExceededError, keeps the note, and saves on retry (L2-026)', async () => {
    const { fixture, host } = setup();
    const history = TestBed.inject(WorkoutHistoryStore);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    let fail = true;
    const original = history.addSession.bind(history);
    vi.spyOn(history, 'addSession').mockImplementation(async (record) => {
      if (fail) throw new DOMException('quota', 'QuotaExceededError');
      return original(record);
    });
    await settleTrain(fixture);

    host.querySelector<HTMLButtonElement>('[data-testid="train-finish"]')!.click();
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { reflectionNote: { set(v: string): void } }).reflectionNote.set(
      'Grateful for steady breathing today.',
    );
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[data-testid="end-workout-save"]')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="end-workout-save-error"]')).not.toBeNull();
    });
    const alert = host.querySelector('[data-testid="end-workout-save-error"]')!;
    expect(alert.textContent).toContain('Could not save session');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/lab');
    expect(host.querySelector('[data-testid="end-workout-dialog"]')).not.toBeNull();
    await vi.waitFor(() =>
      expect(host.querySelector<HTMLTextAreaElement>('[data-testid="end-workout-note"]')!.value).toBe(
        'Grateful for steady breathing today.',
      ),
    );
    expect(TestBed.inject(WorkoutSessionStore).stage()).toBe('running');

    fail = false;
    host.querySelector<HTMLButtonElement>('[data-testid="end-workout-save"]')!.click();
    await vi.waitFor(() => expect(router.navigate).toHaveBeenCalled());
    expect(TestBed.inject(WorkoutSessionStore).stage()).toBe('idle');
  });

  it('reports a generic failure for non-quota errors (L2-026)', async () => {
    const { fixture, host } = setup();
    vi.spyOn(TestBed.inject(WorkoutHistoryStore), 'addSession').mockRejectedValue(new Error('disk'));
    await settleTrain(fixture);
    host.querySelector<HTMLButtonElement>('[data-testid="train-finish"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-testid="end-workout-save"]')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="end-workout-save-error"]')!.textContent).toContain('Something went wrong');
    });
  });
});
