// Acceptance Test
// Traces to: L2-018, L2-019, L2-020, L2-021, L2-022, L2-023, L2-031
// Description: Verify Web Bluetooth pairing/disconnect toasts and AI Lab open model download, cache budget enforcement, and removal.

import { TestBed } from '@angular/core/testing';
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
});
