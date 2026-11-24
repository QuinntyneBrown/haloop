// Acceptance Test
// Traces to: L2-018, L2-019, L2-027, L2-029
// Description: Verify real Web Bluetooth pairing: the chooser opens only through the adapter on a click, parsed
// heart-rate / cadence / battery notifications stream into telemetry locally, labels persist in IndexedDB, and an
// unexpected gattserverdisconnected marks the device Disconnected cleanly.

import { TestBed } from '@angular/core/testing';
import { BluetoothDeviceStore } from '../state/bluetooth-device.store';
import { TelemetryStore } from '../state/telemetry.store';
import { HaloopDbService } from '../storage/haloop-db.service';
import { BleError, WebBluetoothAdapter } from './web-bluetooth.adapter';

class FakeCharacteristic extends EventTarget {
  value?: DataView;
  started = false;
  constructor(private readonly initial?: DataView) {
    super();
    this.value = initial;
  }
  async startNotifications(): Promise<FakeCharacteristic> {
    this.started = true;
    return this;
  }
  async readValue(): Promise<DataView> {
    return this.initial ?? new DataView(new Uint8Array([0]).buffer);
  }
  emit(bytes: number[]): void {
    this.value = new DataView(new Uint8Array(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

class FakeDevice extends EventTarget {
  readonly characteristics = new Map<string, FakeCharacteristic>();
  connects = 0;
  disconnects = 0;
  gatt = {
    connected: false,
    connect: async () => {
      this.connects += 1;
      this.gatt.connected = true;
      return this.gatt;
    },
    disconnect: () => {
      this.disconnects += 1;
      this.gatt.connected = false;
    },
    getPrimaryService: async (service: string) => ({
      getCharacteristic: async (name: string) => {
        const key = `${service}/${name}`;
        const found = this.characteristics.get(key);
        if (!found) throw new DOMException('not found', 'NotFoundError');
        return found;
      },
    }),
  };
  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }
  drop(): void {
    this.gatt.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }
}

function heartRateDevice(): { device: FakeDevice; hr: FakeCharacteristic; battery: FakeCharacteristic } {
  const device = new FakeDevice('strap-1', 'Wahoo TICKR');
  const hr = new FakeCharacteristic();
  const battery = new FakeCharacteristic(new DataView(new Uint8Array([81]).buffer));
  device.characteristics.set('heart_rate/heart_rate_measurement', hr);
  device.characteristics.set('battery_service/battery_level', battery);
  return { device, hr, battery };
}

type RequestSpy = ReturnType<typeof vi.fn>;
const requestSpy = (): RequestSpy => (navigator as unknown as { bluetooth: { requestDevice: RequestSpy } }).bluetooth.requestDevice;

describe('WebBluetoothAdapter GATT streaming', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubBluetooth(requestDevice: () => Promise<unknown>): RequestSpy {
    vi.stubGlobal('navigator', { ...navigator, bluetooth: { requestDevice: vi.fn(requestDevice) } });
    return requestSpy();
  }

  it('requests only heart-rate sensors, streams parsed BPM and battery, and reports drops (L2-018, L2-027)', async () => {
    const { device, hr } = heartRateDevice();
    const request = stubBluetooth(async () => device);
    const bpm: number[] = [];
    const battery: number[] = [];
    let dropped = 0;

    const connection = await TestBed.inject(WebBluetoothAdapter).connect('heart-rate', {
      onHeartRate: (v) => bpm.push(v),
      onBattery: (v) => battery.push(v),
      onDisconnected: () => (dropped += 1),
    });

    expect(request).toHaveBeenCalledWith({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service', 'heart_rate', 'running_speed_and_cadence'],
    });
    expect(connection).toMatchObject({ deviceId: 'strap-1', deviceName: 'Wahoo TICKR', kind: 'heart-rate' });
    expect(hr.started).toBe(true);

    hr.emit([0x00, 132]);
    hr.emit([0x01, 0x98, 0x00]);
    expect(bpm).toEqual([132, 152]);
    expect(battery).toEqual([81]);

    device.drop();
    expect(dropped).toBe(1);

    // A deliberate disconnect is not reported as an unexpected drop.
    connection.disconnect();
    device.drop();
    expect(dropped).toBe(1);
  });

  it('streams running cadence from RSC notifications (L2-018)', async () => {
    const device = new FakeDevice('watch-1', 'Coros');
    const rsc = new FakeCharacteristic();
    device.characteristics.set('running_speed_and_cadence/rsc_measurement', rsc);
    stubBluetooth(async () => device);
    const cadence: number[] = [];

    await TestBed.inject(WebBluetoothAdapter).connect('running', { onCadence: (v) => cadence.push(v) });
    rsc.emit([0x00, 0x00, 0x01, 168]);
    expect(cadence).toEqual([168]);
  });

  it('maps a dismissed chooser, a missing API and missing services to typed errors (L2-029)', async () => {
    const adapter = TestBed.inject(WebBluetoothAdapter);

    stubBluetooth(async () => Promise.reject(new DOMException('cancelled', 'NotFoundError')));
    await expect(adapter.connect('heart-rate', {})).rejects.toMatchObject({ code: 'cancelled' });

    vi.stubGlobal('navigator', { ...navigator, bluetooth: undefined });
    await expect(adapter.connect('heart-rate', {})).rejects.toMatchObject({ code: 'unsupported' });

    const wrong = new FakeDevice('x', 'Odd sensor');
    stubBluetooth(async () => wrong);
    const error = await adapter.connect('heart-rate', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BleError);
    expect((error as BleError).code).toBe('service-missing');
    expect(wrong.disconnects).toBe(1);
  });
});

describe('BluetoothDeviceStore pairing', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => localStorage.clear());

  function setup() {
    const parts = heartRateDevice();
    vi.stubGlobal('navigator', { ...navigator, bluetooth: { requestDevice: vi.fn(async () => parts.device) } });
    TestBed.configureTestingModule({});
    return { ...parts, store: TestBed.inject(BluetoothDeviceStore), telemetry: TestBed.inject(TelemetryStore) };
  }

  it('pairs through the adapter, streams live BPM into telemetry and persists the custom label (L2-018, L2-019)', async () => {
    const { store, telemetry, hr, battery } = setup();
    expect(await store.pairSensor('heart-rate', 'Chest strap')).toBeNull();

    const paired = store.devices().find((d) => d.id === 'strap-1')!;
    expect(paired).toMatchObject({ label: 'Chest strap', connected: true, kind: 'heart-rate', batteryPercent: 81 });
    expect(store.toast()?.title).toBe('Chest strap connected');

    hr.emit([0x00, 143]);
    expect(telemetry.heartRate()).toBe(143);
    expect(telemetry.heartRateSource()).toEqual({ id: 'strap-1', label: 'Chest strap' });

    battery.emit([79]);
    expect(store.devices().find((d) => d.id === 'strap-1')!.batteryPercent).toBe(79);

    const saved = await TestBed.inject(HaloopDbService).get<{ id: string; label: string; connected?: boolean }[]>('devices');
    expect(saved?.find((d) => d.id === 'strap-1')).toMatchObject({ label: 'Chest strap' });
    expect(saved?.every((d) => d.connected === undefined)).toBe(true);
  });

  it('restores paired devices with their custom labels as Disconnected after a reload (L2-019)', async () => {
    const first = setup();
    await first.store.pairSensor('heart-rate', 'Chest strap');
    await vi.waitFor(async () => expect(await TestBed.inject(HaloopDbService).get('devices')).not.toBeNull());

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reloaded = TestBed.inject(BluetoothDeviceStore);
    await vi.waitFor(() => expect(reloaded.devices().find((d) => d.id === 'strap-1')).toBeDefined());
    expect(reloaded.devices().every((d) => !d.connected)).toBe(true);
    expect(reloaded.devices().find((d) => d.id === 'strap-1')!.label).toBe('Chest strap');
    expect(TestBed.inject(TelemetryStore).heartRate()).toBeNull();
  });

  it('marks the device Disconnected on an unexpected gattserverdisconnected and clears only its telemetry (L2-018)', async () => {
    const { store, telemetry, device, hr } = setup();
    await store.pairSensor('heart-rate', 'Chest strap');
    hr.emit([0x00, 120]);

    device.drop();

    expect(store.devices().find((d) => d.id === 'strap-1')!.connected).toBe(false);
    expect(telemetry.heartRate()).toBeNull();
    expect(store.toast()).toMatchObject({ severity: 'danger', title: 'Chest strap disconnected' });
  });

  it('reconnects the same device without another chooser and resumes streaming (L2-018)', async () => {
    const { store, telemetry, device, hr } = setup();
    await store.pairSensor('heart-rate', 'Chest strap');
    device.drop();
    expect(requestSpy()).toHaveBeenCalledTimes(1);

    await store.toggleConnection('strap-1');

    expect(requestSpy()).toHaveBeenCalledTimes(1);
    expect(device.connects).toBe(2);
    expect(store.devices().find((d) => d.id === 'strap-1')!.connected).toBe(true);
    hr.emit([0x00, 111]);
    expect(telemetry.heartRate()).toBe(111);
  });

  it('shows an info toast, not an error, when the chooser is dismissed (L2-029)', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      bluetooth: { requestDevice: async () => Promise.reject(new DOMException('cancelled', 'NotFoundError')) },
    });
    TestBed.configureTestingModule({});
    const store = TestBed.inject(BluetoothDeviceStore);

    expect(await store.pairSensor('heart-rate', 'Chest strap')).toBeNull();

    expect(store.toast()).toMatchObject({ severity: 'info', title: 'Pairing cancelled' });
    expect(store.devices().length).toBe(2);
    expect(store.pairingBusy()).toBe(false);
  });

  it('reports Web Bluetooth as unavailable when the API is missing (L2-029)', async () => {
    vi.stubGlobal('navigator', { ...navigator, bluetooth: undefined });
    TestBed.configureTestingModule({});
    const store = TestBed.inject(BluetoothDeviceStore);
    await store.pairSensor('running', 'Watch');
    expect(store.toast()).toMatchObject({ severity: 'danger', title: 'Web Bluetooth unavailable' });
  });
});
