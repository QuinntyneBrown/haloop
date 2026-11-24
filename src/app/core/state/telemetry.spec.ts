// Acceptance Test
// Traces to: L2-009, L2-018, L2-027
// Description: Verify live BLE heart-rate and cadence telemetry: zone calculation, glitch rejection, clean
// degradation on disconnect, the true session average, and the Train HUD/KPI bindings.

import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { parseBleRunningCadence } from '../wearables/web-bluetooth.adapter';
import { TrainPageComponent } from '../../features/train/train-page.component';
import { settleTrain } from '../../features/train/train-testing';
import { BluetoothDeviceStore } from './bluetooth-device.store';
import { WorkoutHistoryStore } from './workout-history.store';
import { DEFAULT_MAX_HEART_RATE, TelemetryStore, heartRateZone } from './telemetry.store';

const strap = { id: 'strap', label: 'Polar H10' };

describe('heartRateZone', () => {
  it.each([
    [100, 1],
    [114, 2],
    [133, 3],
    [152, 4],
    [171, 5],
    [190, 5],
  ])('%i bpm is zone %i of the default maximum (L2-009)', (bpm, zone) => {
    expect(heartRateZone(bpm, DEFAULT_MAX_HEART_RATE)).toBe(zone);
  });

  it('scales zones to a custom maximum (L2-009)', () => {
    expect(heartRateZone(150, 200)).toBe(3);
    expect(heartRateZone(150, 170)).toBe(4);
  });
});

describe('TelemetryStore', () => {
  let store: TelemetryStore;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TelemetryStore);
  });

  it('updates heart rate, source and zone reactively (L2-009, L2-018)', () => {
    store.ingestHeartRate(128, strap);
    expect(store.heartRate()).toBe(128);
    expect(store.heartRateSource()).toEqual(strap);
    expect(store.zone()).toBe(2);

    store.ingestHeartRate(172, strap);
    expect(store.zone()).toBe(5);
  });

  it('ignores impossible sensor readings (L2-018)', () => {
    store.ingestHeartRate(120, strap);
    for (const glitch of [0, 12, 400, Number.NaN]) store.ingestHeartRate(glitch, strap);
    expect(store.heartRate()).toBe(120);
    store.ingestCadence(-5, strap);
    store.ingestCadence(999, strap);
    expect(store.cadence()).toBeNull();
  });

  it('clears only the dropped sensor and resumes it on reconnect (L2-009)', () => {
    const watch = { id: 'watch', label: 'Coros Pace 3' };
    store.ingestHeartRate(130, strap);
    store.ingestCadence(172, watch);

    store.sensorDisconnected('watch');
    expect(store.cadence()).toBeNull();
    expect(store.heartRate()).toBe(130);

    store.sensorDisconnected('strap');
    expect(store.heartRate()).toBeNull();
    expect(store.zone()).toBeNull();

    store.sensorConnected('strap');
    expect(store.heartRate()).toBe(130);
  });

  it('averages the readings recorded over the session and resets (L2-018)', () => {
    expect(store.averageBpm()).toBeNull();
    store.ingestHeartRate(120, strap);
    store.sample();
    store.ingestHeartRate(140, strap);
    store.sample();
    store.sample();
    expect(store.averageBpm()).toBe(133);

    store.sensorDisconnected('strap');
    store.sample(); // no reading: not counted as a zero
    expect(store.averageBpm()).toBe(133);

    store.resetSession();
    expect(store.averageBpm()).toBeNull();
  });

  it('parses running cadence from an RSC measurement payload (L2-018)', () => {
    const payload = new DataView(new Uint8Array([0x00, 0x00, 0x01, 172]).buffer);
    expect(parseBleRunningCadence(payload)).toBe(172);
    expect(parseBleRunningCadence(new DataView(new Uint8Array([0x00]).buffer))).toBe(0);
  });
});

describe('Train telemetry binding', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'history/:id', children: [] }]),
        {
          provide: MlWorkerClient,
          useValue: { warmUp: async () => true, disposePose: async () => undefined, synthesizeCue: async () => ({ samples: null }) },
        },
      ],
    });
    TestBed.inject(DOCUMENT);
    const fixture = TestBed.createComponent(TrainPageComponent);
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }
  const text = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? '';

  it('shows live BPM and zone in the HUD and KPI card and follows new notifications (L2-009)', async () => {
    const { fixture, host } = setup();
    const telemetry = TestBed.inject(TelemetryStore);
    await settleTrain(fixture);
    expect(text(host, 'train-hud-hr')).toBe('134 bpm · Zone 3');
    expect(text(host, 'train-kpi-hr')).toBe('134 bpm');
    expect(text(host, 'train-kpi-hr-source')).toBe('Polar H10 · Live');

    telemetry.ingestHeartRate(175, { id: 'polar-h10', label: 'Polar H10' });
    fixture.detectChanges();
    expect(text(host, 'train-hud-hr')).toBe('175 bpm · Zone 5');
    expect(text(host, 'train-kpi-hr')).toBe('175 bpm');
  });

  it('shows live cadence when a running sensor reports (L2-018)', async () => {
    const { fixture, host } = setup();
    await settleTrain(fixture);
    expect(host.textContent).toContain('3-1-1');
    TestBed.inject(TelemetryStore).ingestCadence(168, { id: 'coros-pace-3', label: 'Coros Pace 3' });
    fixture.detectChanges();
    expect(text(host, 'train-kpi-cadence')).toBe('168 spm');
  });

  it('keeps counting reps after the sensor disconnects mid-workout and saves the true average (L2-009, L2-018)', async () => {
    const { fixture, host } = setup();
    const telemetry = TestBed.inject(TelemetryStore);
    const history = TestBed.inject(WorkoutHistoryStore);
    const add = vi.spyOn(history, 'addSession').mockResolvedValue(undefined);
    await settleTrain(fixture);

    telemetry.resetSession();
    telemetry.ingestHeartRate(120, { id: 'polar-h10', label: 'Polar H10' });
    telemetry.sample();
    telemetry.ingestHeartRate(140, { id: 'polar-h10', label: 'Polar H10' });
    telemetry.sample();

    TestBed.inject(BluetoothDeviceStore).toggleConnection('polar-h10');
    fixture.detectChanges();
    expect(text(host, 'train-hud-hr')).toBe('No heart-rate sensor');
    expect(text(host, 'train-kpi-hr')).toBe('—');
    expect(text(host, 'train-kpi-hr-source')).toBe('Pair a sensor in Devices');

    // Rep counting and finishing continue without the sensor.
    host.querySelector<HTMLButtonElement>('[data-testid="train-next-set"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="train-finish"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-testid="end-workout-save"]')!.click();
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0][0].avgHeartRateBpm).toBe(130);
  });

  it('records 0 bpm (shown as a dash) when no heart-rate sensor was connected (L2-018)', async () => {
    const { fixture, host } = setup();
    const history = TestBed.inject(WorkoutHistoryStore);
    const add = vi.spyOn(history, 'addSession').mockResolvedValue(undefined);
    TestBed.inject(BluetoothDeviceStore).toggleConnection('polar-h10');
    TestBed.inject(TelemetryStore).resetSession();
    await settleTrain(fixture);

    host.querySelector<HTMLButtonElement>('[data-testid="train-finish"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-testid="end-workout-save"]')!.click();
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0][0].avgHeartRateBpm).toBe(0);
    expect(add.mock.calls[0][0].sensorsUsed).toBe('VitPose');
  });
});
