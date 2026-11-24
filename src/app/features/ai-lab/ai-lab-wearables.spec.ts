// Acceptance Test
// Traces to: L2-018, L2-019, L2-020, L2-021, L2-022, L2-023, L2-031
// Description: Verify Web Bluetooth pairing/disconnect toasts and AI Lab open model download, cache budget enforcement, and removal.

import { TestBed } from '@angular/core/testing';
import { MlWorkerClient } from '../../core/ai/ml-worker.client';
import { BluetoothDeviceStore } from '../../core/state/bluetooth-device.store';
import { ModelRegistryStore } from '../../core/state/model-registry.store';

describe('Wearables & AI Lab Stores (Slices 6-7)', () => {
  let bt: BluetoothDeviceStore;
  let models: ModelRegistryStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    bt = TestBed.inject(BluetoothDeviceStore);
    models = TestBed.inject(ModelRegistryStore);
  });

  it('validates Bluetooth device label, pairs sensor, and emits success toast (L2-019, L2-020)', async () => {
    const err = await bt.pairSensor('wahoo-tickr-fit', '   ', 'HR armband');
    expect(err).not.toBeNull();

    const ok = await bt.pairSensor('wahoo-tickr-fit', 'Wahoo TICKR Fit', 'HR armband');
    expect(ok).toBeNull();
    expect(bt.toast()?.severity).toBe('success');
    expect(bt.devices().some((d) => d.label === 'Wahoo TICKR Fit')).toBe(true);
  });

  it('tracks 286 MB cached core models and supports downloading and removing models (L2-022, L2-023, L2-031)', async () => {
    expect(models.cachedMb()).toBe(286);

    await models.downloadModel('qwen');
    expect(models.cachedMb()).toBe(766);

    await models.removeModel('qwen');
    expect(models.cachedMb()).toBe(286);
    expect(models.toasts().some((t) => t.title.includes('Removed'))).toBe(true);
  });

  describe('Qwen2.5-0.5B-Instruct real model cache (L2-022, L2-023, L2-027)', () => {
    function configure(worker: Partial<MlWorkerClient>): ModelRegistryStore {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: MlWorkerClient, useValue: { workerSupported: true, ...worker } }],
      });
      return TestBed.inject(ModelRegistryStore);
    }

    const qwen = (store: ModelRegistryStore) => store.models().find((m) => m.id === 'qwen')!;

    it('shows the Coach fallback as Ready when it is already cached in this browser', async () => {
      const store = configure({ qwenCacheStatus: async () => true });
      await Promise.resolve();
      await Promise.resolve();
      expect(qwen(store).state).toBe('ready');
      expect(store.cachedMb()).toBe(766);
    });

    it('downloads through the ML worker, tracks byte progress, and marks the model Ready', async () => {
      let release: (value: { ok: boolean }) => void = () => undefined;
      const store = configure({
        qwenCacheStatus: async () => false,
        downloadQwen: (backend, onProgress) => {
          expect(backend).toBe('AutoWebGpu');
          onProgress({ loadedBytes: 120_000_000, totalBytes: 483_000_000 });
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      });

      const download = store.downloadModel('qwen');
      expect(qwen(store).state).toBe('downloading');
      expect(qwen(store).downloadedMb).toBe(120);

      release({ ok: true });
      await download;
      expect(qwen(store).state).toBe('ready');
      expect(store.cachedMb()).toBe(766);
    });

    it('returns to Download with an error toast when the download fails', async () => {
      const store = configure({
        qwenCacheStatus: async () => false,
        downloadQwen: async () => ({ ok: false, reason: 'Failed to fetch' }),
      });

      await store.downloadModel('qwen');

      expect(qwen(store).state).toBe('not-downloaded');
      expect(store.cachedMb()).toBe(286);
      expect(store.toasts().at(-1)?.severity).toBe('danger');
    });

    it('keeps the model Ready when clearing the cache fails', async () => {
      const store = configure({
        qwenCacheStatus: async () => true,
        removeQwen: async () => ({ ok: false, reason: 'blocked' }),
      });
      await Promise.resolve();
      await Promise.resolve();

      await store.removeModel('qwen');

      expect(qwen(store).state).toBe('ready');
      expect(store.toasts().at(-1)?.severity).toBe('danger');
    });
  });
});
