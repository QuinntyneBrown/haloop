// Acceptance Test
// Traces to: L2-012, L2-013
// Description: Verify the Coach page shows the loading skeleton until persisted messages are read from
// IndexedDB, and that Apply light-load warm-up updates the workout plan and navigates to /train.

import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HaloopDbService } from '../../core/storage/haloop-db.service';
import { LIGHT_LOAD_WARM_UP, WorkoutPlanStore } from '../../core/state/workout-plan.store';
import { CoachPageComponent } from './coach-page.component';
import { TrainPageComponent } from '../train/train-page.component';
import { settleTrain } from '../train/train-testing';

describe('Coach loading and workout hand-off', () => {
  it('renders skeleton placeholders until coachMessages finishes loading (L2-012)', async () => {
    let release: (value: unknown) => void = () => undefined;
    const db = { get: () => new Promise((resolve) => (release = resolve)), set: async () => undefined };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: HaloopDbService, useValue: db }],
    });
    const fixture = TestBed.createComponent(CoachPageComponent);
    const host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="coach-loading"]')).not.toBeNull();
    expect(host.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(host.querySelector('.chat-thread')).toBeNull();

    release([
      { id: 'a', sender: 'user', author: 'Micah', time: '07:00', text: 'Saved question' },
    ]);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="coach-loading"]')).toBeNull();
    });
    expect(host.textContent).toContain('Saved question');
  });

  it('shows the default thread once loading finishes with nothing saved (L2-012)', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: HaloopDbService, useValue: { get: async () => null, set: async () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(CoachPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="coach-loading"]')).toBeNull();
    });
    expect(fixture.nativeElement.querySelector('[data-testid="coach-apply-warmup"]')).not.toBeNull();
  });

  it('applies the light-load warm-up to the plan and navigates to /train (L2-013)', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'train', component: TrainPageComponent }]),
        { provide: HaloopDbService, useValue: { get: async () => null, set: async () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(CoachPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="coach-apply-warmup"]')).not.toBeNull();
    });

    fixture.nativeElement.querySelector('[data-testid="coach-apply-warmup"]').click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/train'));

    const plan = TestBed.inject(WorkoutPlanStore);
    expect(plan.adjustment()).toEqual(LIGHT_LOAD_WARM_UP);
    expect(plan.adjustment()?.loadChangePercent).toBe(-20);
    expect(plan.adjustment()?.warmUp.durationSeconds).toBe(90);
  });

  it('shows the applied adjustment on the Train page and lets it be dismissed (L2-013)', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(WorkoutPlanStore).apply(LIGHT_LOAD_WARM_UP);
    const fixture = TestBed.createComponent(TrainPageComponent);
    const host = fixture.nativeElement as HTMLElement;
    await settleTrain(fixture);

    const banner = host.querySelector('[data-testid="train-adjustment-banner"]')!;
    expect(banner.textContent).toContain('−20% load');
    expect(banner.textContent).toContain('90 seconds of slow ankle rocks');

    host.querySelector<HTMLButtonElement>('[data-testid="train-adjustment-dismiss"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="train-adjustment-banner"]')).toBeNull();
    fixture.destroy();
  });
});
