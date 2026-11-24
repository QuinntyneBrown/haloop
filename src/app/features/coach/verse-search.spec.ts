// Acceptance Test
// Traces to: L2-014, L2-025, L2-028
// Description: Verify the verse-search dialog shows a busy state while embeddings compute, validates an empty query,
// inserts a verse into the composer, renders verse text escaped, and translates every supported language locally.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChromeAiService } from '../../core/ai/chrome-ai.service';
import { MlWorkerClient } from '../../core/ai/ml-worker.client';
import { SUPPORTED_SCRIPTURE_LANGUAGES } from '../../core/state/preferences.store';
import { HaloopDbService } from '../../core/storage/haloop-db.service';
import { CoachPageComponent } from './coach-page.component';

type Hit = { reference: string; text: string; score: number };

function setup(search: (query: string) => Promise<readonly Hit[]>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: HaloopDbService, useValue: { get: async () => null, set: async () => undefined } },
      { provide: MlWorkerClient, useValue: { semanticSearch: (q: string) => search(q) } },
    ],
  });
  const fixture = TestBed.createComponent(CoachPageComponent);
  const host = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, host, q, settle };
}

describe('Verse search dialog', () => {
  it('shows the busy skeleton and disables Search until the worker answers (L2-014)', async () => {
    let answer: (hits: Hit[]) => void = () => undefined;
    const { fixture, q } = setup(() => new Promise((resolve) => (answer = resolve)));

    q('coach-open-verse-search')!.click();
    fixture.detectChanges();
    expect(q('verse-search-busy')).not.toBeNull();
    expect(q('verse-search-submit')!.hasAttribute('disabled')).toBe(true);
    expect(q('verse-insert-btn')).toBeNull();

    answer([{ reference: 'Hebrews 12:1', text: 'let us run with patience', score: 0.8 }]);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q('verse-search-busy')).toBeNull();
    });
    expect(q('verse-search-submit')!.hasAttribute('disabled')).toBe(false);
    expect(q('verse-insert-btn')).not.toBeNull();
  });

  it('validates an empty query without calling the worker (L2-014)', async () => {
    const search = vi.fn(async () => [] as Hit[]);
    const { fixture, host, q, settle } = setup(search);
    q('coach-open-verse-search')!.click();
    await settle();
    search.mockClear();

    const input = q('verse-search-input') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    host.querySelector('[data-testid="verse-search-dialog"] form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(host.querySelector('[data-testid="verse-search-dialog"] [role="alert"]')?.textContent).toContain(
      'Enter a theme, keyword, or reference',
    );
    expect(search).not.toHaveBeenCalled();
    expect(q('verse-search-busy')).toBeNull();
  });

  it('inserts the chosen verse into the composer and closes the dialog (L2-025)', async () => {
    const { q, settle } = setup(async () => [{ reference: 'Isaiah 40:31', text: 'they shall run', score: 0.9 }]);
    q('coach-open-verse-search')!.click();
    await settle();

    q('verse-insert-btn')!.click();
    await settle();

    expect((q('coach-prompt-input') as HTMLInputElement).value).toContain('Reflect on Isaiah 40:31');
    expect(q('verse-search-dialog')).toBeNull();
  });

  it('renders verse text as escaped text, never markup (L2-028)', async () => {
    const { host, q, settle } = setup(async () => [
      { reference: 'Psalm 1:1', text: '<img src=x onerror=alert(1)> blessed', score: 0.5 },
    ]);
    q('coach-open-verse-search')!.click();
    await settle();
    expect(host.querySelector('[data-testid="verse-search-dialog"] img')).toBeNull();
    expect(host.querySelector('[data-testid="verse-search-dialog"]')!.textContent).toContain('<img src=x');
  });

  it('shows a recoverable error and clears busy when the worker fails (L2-030)', async () => {
    const { q, host, settle } = setup(() => Promise.reject(new Error('worker down')));
    q('coach-open-verse-search')!.click();
    await settle();
    expect(q('verse-search-busy')).toBeNull();
    expect(host.querySelector('[data-testid="verse-search-dialog"] [role="alert"]')?.textContent).toContain('unavailable');
  });

  it('ignores a stale response that arrives after the dialog was closed (L2-014)', async () => {
    let answer: (hits: Hit[]) => void = () => undefined;
    const { q, settle } = setup(() => new Promise((resolve) => (answer = resolve)));
    q('coach-open-verse-search')!.click();
    await settle();
    q('verse-search-dialog')!.querySelector<HTMLButtonElement>('.dialog__footer button')!.click();
    answer([{ reference: 'Hebrews 12:1', text: 'late', score: 1 }]);
    await settle();
    expect(q('verse-search-dialog')).toBeNull();

    q('coach-open-verse-search')!.click();
    await settle();
    expect(q('verse-insert-btn')).toBeNull();
  });
});

describe('Scripture translation via the Translator API', () => {
  afterEach(() => vi.unstubAllGlobals());

  const OTHER_LANGUAGES = SUPPORTED_SCRIPTURE_LANGUAGES.filter((l) => l.code !== 'en');

  it('supports English plus 11 translated languages (L2-028)', () => {
    expect(SUPPORTED_SCRIPTURE_LANGUAGES.length).toBe(12);
    expect(OTHER_LANGUAGES.length).toBe(11);
  });

  it('translates locally into every supported language when the pack is available (L2-028)', async () => {
    const created: string[] = [];
    vi.stubGlobal('Translator', {
      availability: async () => 'available',
      create: async ({ targetLanguage }: { targetLanguage: string }) => {
        created.push(targetLanguage);
        return { translate: async (t: string) => `[${targetLanguage}] ${t}` };
      },
    });
    const ai = TestBed.inject(ChromeAiService);
    for (const { code } of OTHER_LANGUAGES) {
      expect(await ai.translateText('Run with patience', code, 'KJV fallback')).toBe(`[${code}] Run with patience`);
    }
    expect([...created].sort()).toEqual(OTHER_LANGUAGES.map((l) => l.code).sort());

    // The translator for a language is created once and reused.
    await ai.translateText('Again', 'es', 'x');
    expect(created.filter((c) => c === 'es').length).toBe(1);
  });

  it('falls back without creating a translator when the language pair is unavailable (L2-028)', async () => {
    const create = vi.fn();
    vi.stubGlobal('Translator', { availability: async () => 'unavailable', create });
    expect(await TestBed.inject(ChromeAiService).translateText('Rest', 'sw', 'KJV fallback')).toBe('KJV fallback');
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back when the Translator API is missing or throws (L2-028)', async () => {
    expect(await TestBed.inject(ChromeAiService).translateText('Rest', 'fr', 'fallback')).toBe('fallback');
    vi.stubGlobal('Translator', {
      create: async () => {
        throw new Error('pack failed');
      },
    });
    expect(await TestBed.inject(ChromeAiService).translateText('Rest', 'fr', 'fallback')).toBe('fallback');
  });

  it('never translates English (L2-028)', async () => {
    expect(await TestBed.inject(ChromeAiService).translateText('Rest', 'en', 'x')).toBe('Rest');
  });
});
