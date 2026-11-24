// Acceptance Test
// Traces to: L2-021, L2-022, L2-023, L2-026
// Description: Verify /lab renders its loading, empty and blocked-storage error states, keeps the remove dialog open
// with an actionable error when deletion fails, and re-probes the real Chrome Built-in AI APIs on Re-check.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MlWorkerClient } from '../../core/ai/ml-worker.client';
import { AiLabPageComponent } from './ai-lab-page.component';

type Worker = Partial<MlWorkerClient>;

function render(worker: Worker = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: MlWorkerClient,
        useValue: {
          workerSupported: true,
          probeModelStorage: async () => ({ ok: true }),
          qwenCacheStatus: async () => false,
          modelCacheStatus: async () => false,
          ...worker,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(AiLabPageComponent);
  const host = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const settle = (check: () => void) =>
    vi.waitFor(() => {
      fixture.detectChanges();
      check();
    });
  return { fixture, host, q, settle };
}

describe('AI Lab states', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('shows the loading skeleton while the capability and cache probes run (L2-021)', async () => {
    let release: (v: { ok: boolean }) => void = () => undefined;
    const { q, host, settle } = render({ probeModelStorage: () => new Promise((resolve) => (release = resolve)) });

    expect(q('ailab-loading')).not.toBeNull();
    expect(host.textContent).toContain('Checking Gemini Nano capabilities');
    expect(host.textContent).toContain('Inspecting local Cache Storage');
    expect(q('ailab-download-qwen')).toBeNull();

    release({ ok: true });
    await settle(() => expect(q('ailab-loading')).toBeNull());
    expect(host.textContent).toContain('Prompt API');
  });

  it('shows the empty state with a 0 MB budget bar when nothing is cached (L2-022)', async () => {
    const { q, host, settle } = render();
    await settle(() => expect(q('ailab-empty')).not.toBeNull());
    expect(host.textContent).toContain('No open models cached yet');
    expect(host.textContent).toContain('0 MB cached');
    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('hides the empty state once any model is cached (L2-022)', async () => {
    const { q, host, settle } = render({ modelCacheStatus: async (id: string) => id === 'minilm' });
    await settle(() => expect(host.textContent).toContain('23 MB cached'));
    expect(q('ailab-empty')).toBeNull();
  });

  it('shows the blocked-storage error, keeps built-in APIs visible, and Retry check recovers (L2-026)', async () => {
    let blocked = true;
    const { q, host, settle } = render({
      probeModelStorage: async () => (blocked ? { ok: false, reason: 'SecurityError: storage is disabled' } : { ok: true }),
    });
    await settle(() => expect(q('ailab-storage-error')).not.toBeNull());
    expect(q('ailab-storage-error')!.textContent).toContain('Could not read on-device model storage');
    expect(q('ailab-storage-error')!.textContent).toContain('SecurityError');
    expect(q('ailab-storage-error')!.querySelector('a[href="/settings"]')?.textContent).toContain('Check storage settings');
    expect(host.textContent).toContain('Prompt API');
    expect(q('ailab-empty')).toBeNull();
    expect(host.textContent).toContain('0 MB cached');

    blocked = false;
    q('ailab-retry-check')!.click();
    await settle(() => expect(q('ailab-storage-error')).toBeNull());
    await settle(() => expect(q('ailab-empty')).not.toBeNull());
  });

  it('keeps the remove dialog open with an actionable error when deletion fails, then succeeds on retry (L2-022)', async () => {
    let fail = true;
    const { q, host, settle } = render({
      modelCacheStatus: async () => true,
      removeModelFiles: async () => (fail ? { ok: false, reason: 'VitPose is loaded in an open Train tab.' } : { ok: true }),
    });
    await settle(() => expect(q('ailab-remove-vitpose')).not.toBeNull());
    await settle(() => expect(host.textContent).toContain('286 MB cached'));

    q('ailab-remove-vitpose')!.click();
    await settle(() => expect(q('remove-model-dialog')).not.toBeNull());
    q('remove-model-confirm')!.click();

    await settle(() => expect(q('remove-model-error')).not.toBeNull());
    expect(q('remove-model-dialog')).not.toBeNull();
    expect(q('remove-model-error')!.textContent).toContain('Could not delete model cache');
    expect(q('remove-model-error')!.textContent).toContain('Train tab');
    expect(q('remove-model-confirm')!.textContent).toContain('Retry remove');
    expect(host.textContent).toContain('286 MB cached');

    fail = false;
    q('remove-model-confirm')!.click();
    await settle(() => expect(q('remove-model-dialog')).toBeNull());
    expect(host.textContent).toContain('192 MB cached');
  });

  it('clears a stale remove error when the dialog is reopened (L2-022)', async () => {
    const { q, host, settle } = render({
      modelCacheStatus: async () => true,
      removeModelFiles: async () => ({ ok: false, reason: 'blocked' }),
    });
    await settle(() => expect(host.textContent).toContain('286 MB cached'));
    q('ailab-remove-vitpose')!.click();
    await settle(() => expect(q('remove-model-confirm')).not.toBeNull());
    q('remove-model-confirm')!.click();
    await settle(() => expect(q('remove-model-error')).not.toBeNull());

    host.querySelector<HTMLButtonElement>('[data-testid="remove-model-dialog"] .dialog__footer .btn:not(.btn--danger)')!.click();
    await settle(() => expect(q('remove-model-dialog')).toBeNull());
    q('ailab-remove-vitpose')!.click();
    await settle(() => expect(q('remove-model-dialog')).not.toBeNull());
    expect(q('remove-model-error')).toBeNull();
  });
});

describe('Chrome flags re-check', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  async function openFlags() {
    const env = render();
    await env.settle(() => expect(env.q('ailab-writer-flag-btn')).not.toBeNull());
    env.q('ailab-writer-flag-btn')!.click();
    await env.settle(() => expect(env.q('chrome-flags-dialog')).not.toBeNull());
    return env;
  }

  it('stays open and explains when the Writer API is still unavailable (L2-023)', async () => {
    vi.stubGlobal('Writer', { availability: async () => 'unavailable' });
    const { q, settle } = await openFlags();

    q('chrome-flags-recheck')!.click();

    await settle(() => expect(q('chrome-flags-result')).not.toBeNull());
    expect(q('chrome-flags-dialog')).not.toBeNull();
    expect(q('chrome-flags-result')!.textContent).toContain('still not detected');
    expect(q('ailab-writer-flag-btn')).not.toBeNull();
  });

  it('closes and shows Writer & Rewriter Available once Chrome really reports it (L2-023)', async () => {
    const { q, host, settle } = await openFlags();
    vi.stubGlobal('Writer', { availability: async () => 'downloadable' });

    q('chrome-flags-recheck')!.click();

    await settle(() => expect(q('chrome-flags-dialog')).toBeNull());
    expect(q('ailab-writer-flag-btn')).toBeNull();
    expect(host.textContent).toContain('Writer & Rewriter');
  });

  it('treats a throwing availability probe as unavailable instead of failing (L2-023)', async () => {
    vi.stubGlobal('Writer', {
      availability: async () => {
        throw new Error('blocked by policy');
      },
    });
    const { q, settle } = await openFlags();
    q('chrome-flags-recheck')!.click();
    await settle(() => expect(q('chrome-flags-result')).not.toBeNull());
  });
});
