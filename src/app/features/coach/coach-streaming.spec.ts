// Acceptance Test
// Traces to: L2-012, L2-028, L2-030
// Description: Verify the Coach page renders streamed chunks live inside the in-progress bubble, keeps the
// composer disabled while generating, and renders streamed text strictly as escaped text.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChromeAiService } from '../../core/ai/chrome-ai.service';
import { HaloopDbService } from '../../core/storage/haloop-db.service';
import { CoachPageComponent } from './coach-page.component';

describe('Coach streaming', () => {
  it('appends streamed chunks into the active bubble while the composer is disabled (L2-012, L2-030)', async () => {
    let emit: (text: string) => void = () => undefined;
    let finish: () => void = () => undefined;
    const fake = {
      promptCoach: (_prompt: string, onChunk?: (text: string) => void) => {
        emit = onChunk ?? emit;
        return new Promise((resolve) => {
          finish = () => resolve({ text: 'Done <b>bold</b>', reflection: 'r', engine: 'Haloop Coach · Test' });
        });
      },
      resetPromptSession: () => undefined,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ChromeAiService, useValue: fake },
        { provide: HaloopDbService, useValue: { get: async () => null, set: async () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(CoachPageComponent);
    const host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();

    const input = host.querySelector<HTMLInputElement>('[data-testid="coach-prompt-input"]')!;
    input.value = 'Pace my run';
    input.dispatchEvent(new Event('input'));
    host.querySelector('form.chat-composer')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(host.textContent).toContain('Generating on-device…');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="coach-send"]')!.disabled).toBe(true);

    emit('<img src=x onerror=alert(1)> Easy ');
    fixture.detectChanges();
    const streaming = host.querySelector('[data-testid="coach-streaming-text"]')!;
    expect(streaming.textContent).toContain('Easy');
    expect(streaming.querySelector('img')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[data-testid="coach-send"]')!.disabled).toBe(true);

    finish();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('[data-testid="coach-streaming-text"]')).toBeNull();
    });
    expect(host.querySelector('[data-testid="coach-streaming-text"]')).toBeNull();
    expect(host.textContent).toContain('Done <b>bold</b>');
    expect(host.querySelector<HTMLButtonElement>('[data-testid="coach-send"]')!.disabled).toBe(false);
  });
});
