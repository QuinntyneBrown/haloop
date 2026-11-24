import { expect, vi } from 'vitest';
import { ComponentFixture } from '@angular/core/testing';

/** Renders a Train page fixture and waits for the model warm-up skeleton to give way to the workout UI. */
export async function settleTrain(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="train-loading"]')).toBeNull();
  });
}
