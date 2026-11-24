import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { AdapterStatus, BleConnection, BleError, BleHandlers, SensorKind, WebBluetoothAdapter } from '../wearables/web-bluetooth.adapter';
import { HaloopDbService } from '../storage/haloop-db.service';
import { SystemStatusStore } from './system-status.store';
import { TelemetryStore } from './telemetry.store';
import { validateDeviceLabel } from '../security/sanitize';

export interface WearableDevice {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly kind: SensorKind;
  readonly batteryPercent: number;
  readonly connected: boolean;
}

export interface DeviceToast {
  readonly severity: 'info' | 'success' | 'warning' | 'danger';
  readonly title: string;
  readonly message: string;
  /** Optional action button, e.g. Reconnect on a disconnect toast. */
  readonly action?: { readonly label: string; readonly deviceId: string };
}

export type PairOutcome = 'connected' | 'cancelled' | 'timeout' | 'failed';

/** Batteries at or below this level raise a warning toast. */
export const LOW_BATTERY_PERCENT = 15;

/** How long pairing or reconnecting may take before it is reported as timed out. */
export const PAIRING_TIMEOUT_MS = new InjectionToken<number>('haloop.pairingTimeoutMs', {
  providedIn: 'root',
  factory: () => 45_000,
});

/** Only metadata is persisted: no readings, no identifiers beyond the browser-scoped device id. */
type PersistedDevice = Omit<WearableDevice, 'connected'>;

const INITIAL_DEVICES: readonly WearableDevice[] = [
  {
    id: 'polar-h10',
    label: 'Polar H10',
    role: 'Heart-rate chest strap · 72 bpm resting',
    kind: 'heart-rate',
    batteryPercent: 88,
    connected: true,
  },
  {
    id: 'coros-pace-3',
    label: 'Coros Pace 3',
    role: 'Running watch · Cadence & pace',
    kind: 'running',
    batteryPercent: 64,
    connected: true,
  },
];

const KIND_ROLE: Record<SensorKind, string> = {
  'heart-rate': 'Heart-rate sensor · Live BPM',
  running: 'Running sensor · Cadence',
};

@Injectable({ providedIn: 'root' })
export class BluetoothDeviceStore {
  private readonly systemStatus = inject(SystemStatusStore);
  private readonly telemetry = inject(TelemetryStore);
  private readonly adapter = inject(WebBluetoothAdapter);
  private readonly db = inject(HaloopDbService);
  private readonly pairingTimeoutMs = inject(PAIRING_TIMEOUT_MS);

  readonly devices = signal<readonly WearableDevice[]>(INITIAL_DEVICES);
  readonly toast = signal<DeviceToast | null>(null);
  readonly pairingBusy = signal<boolean>(false);
  /** False until persisted devices have been read from IndexedDB. */
  readonly loaded = signal<boolean>(false);
  readonly adapterStatus = signal<AdapterStatus | 'checking'>('checking');
  readonly pairOutcome = signal<PairOutcome | null>(null);

  private readonly connections = new Map<string, BleConnection>();
  /** Battery reported while the device is still being added to the list. */
  private readonly batteryById = new Map<string, number>();
  /** Devices already warned about, so a drained battery warns once until it recovers. */
  private readonly lowBatteryWarned = new Set<string>();

  constructor() {
    // The default device list mirrors a paired Polar H10 strap that is already streaming (matches the mocks);
    // live GATT notifications replace these readings as soon as a sensor reports.
    this.telemetry.ingestHeartRate(134, { id: 'polar-h10', label: 'Polar H10' });
    void this.restore();
  }

  /** Reloads paired-device metadata. A page reload drops every GATT link, so all devices start Disconnected. */
  private async restore(): Promise<void> {
    try {
      await this.loadPersisted();
    } finally {
      this.loaded.set(true);
    }
  }

  /** Re-checks whether the Bluetooth radio is usable; backs the adapter-off `Check again` action. */
  async checkAdapter(): Promise<void> {
    this.adapterStatus.set('checking');
    this.adapterStatus.set(await this.adapter.status());
  }

  private async loadPersisted(): Promise<void> {
    let saved: PersistedDevice[] | null = null;
    try {
      saved = await this.db.get<PersistedDevice[]>('devices');
    } catch {
      return;
    }
    if (!Array.isArray(saved) || this.devices().some((d) => !INITIAL_DEVICES.some((i) => i.id === d.id))) {
      return;
    }
    for (const device of this.devices()) {
      this.telemetry.sensorDisconnected(device.id);
    }
    this.devices.set(saved.map((d) => ({ ...d, connected: false })));
    this.syncCount();
  }

  private persist(): void {
    const metadata: PersistedDevice[] = this.devices().map(({ connected: _connected, ...rest }) => rest);
    void this.db.set('devices', metadata).catch(() => undefined);
  }

  /**
   * Opens the browser's Bluetooth chooser (call only from a click), connects and starts streaming.
   * Resolves with a validation message for the label field, or `null` on success or a reported failure.
   */
  async pairSensor(kind: SensorKind, customLabel: string, role: string = KIND_ROLE[kind]): Promise<string | null> {
    const err = validateDeviceLabel(customLabel);
    if (err) {
      return err;
    }
    const cleanLabel = customLabel.trim();
    this.pairingBusy.set(true);
    this.pairOutcome.set(null);
    this.toast.set({
      severity: 'info',
      title: 'Scanning for Bluetooth sensors',
      message: 'Choose your sensor in the browser prompt and keep it awake within 2 meters.',
    });

    try {
      const connection = await this.connectWithTimeout(kind, cleanLabel);
      const id = connection.deviceId;
      this.connections.set(id, connection);
      const device: WearableDevice = {
        id,
        label: cleanLabel,
        role,
        kind,
        batteryPercent: this.batteryById.get(id) ?? 0,
        connected: true,
      };
      this.devices.update((list) => [...list.filter((d) => d.id !== id), device]);
      this.syncCount();
      this.persist();
      this.pairOutcome.set('connected');
      this.toast.set({
        severity: 'success',
        title: `${cleanLabel} connected`,
        message: kind === 'heart-rate' ? 'Live heart rate is now streaming to Train.' : 'Live cadence is now streaming to Train.',
      });
    } catch (error) {
      this.reportFailure(error);
    } finally {
      this.pairingBusy.set(false);
    }
    return null;
  }

  /** Disconnects a connected sensor, or reconnects a disconnected one. */
  async toggleConnection(id: string): Promise<void> {
    const device = this.devices().find((d) => d.id === id);
    if (!device) {
      return;
    }
    if (device.connected) {
      this.connections.get(id)?.disconnect();
      this.markConnected(id, false);
      this.toast.set({
        severity: 'danger',
        title: `${device.label} disconnected`,
        message: 'Signal disconnected. Move closer and reconnect anytime.',
        action: { label: 'Reconnect', deviceId: id },
      });
      return;
    }

    this.pairingBusy.set(true);
    try {
      const existing = this.connections.get(id);
      if (existing) {
        await this.withTimeout(existing.reconnect());
      } else {
        // After a reload (or for a demo device) the browser needs the user to pick the sensor again.
        const connection = await this.connectWithTimeout(device.kind, device.label);
        if (connection.deviceId !== id) {
          // The user picked a different physical sensor: track it under its own id with the same label.
          this.devices.update((list) =>
            list.map((d) => (d.id === id ? { ...d, id: connection.deviceId, batteryPercent: this.batteryById.get(connection.deviceId) ?? 0 } : d)),
          );
          this.persist();
          id = connection.deviceId;
        }
        this.connections.set(id, connection);
      }
      this.markConnected(id, true);
      this.toast.set({ severity: 'success', title: `${device.label} connected`, message: 'Live telemetry resumed.' });
    } catch (error) {
      this.reportFailure(error);
    } finally {
      this.pairingBusy.set(false);
    }
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  /** Removes a paired device and everything remembered about it. */
  forgetDevice(id: string): void {
    this.connections.get(id)?.disconnect();
    this.connections.delete(id);
    this.batteryById.delete(id);
    this.lowBatteryWarned.delete(id);
    this.telemetry.sensorDisconnected(id);
    this.devices.update((list) => list.filter((d) => d.id !== id));
    this.syncCount();
    this.persist();
  }

  /** Races a GATT operation against the pairing timeout; a connection that arrives late is closed again. */
  private connectWithTimeout(kind: SensorKind, label: string): Promise<BleConnection> {
    return new Promise<BleConnection>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new BleError('timeout', 'Pairing timed out.'));
      }, this.pairingTimeoutMs);
      this.adapter.connect(kind, this.handlersFor(label)).then(
        (connection) => {
          clearTimeout(timer);
          if (timedOut) {
            connection.disconnect();
          } else {
            resolve(connection);
          }
        },
        (error: unknown) => {
          clearTimeout(timer);
          if (!timedOut) {
            reject(error);
          }
        },
      );
    });
  }

  private withTimeout<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new BleError('timeout', 'Reconnecting timed out.')), this.pairingTimeoutMs);
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private reportFailure(error: unknown): void {
    const code = error instanceof BleError ? error.code : 'connect-failed';
    this.pairOutcome.set(code === 'cancelled' ? 'cancelled' : code === 'timeout' ? 'timeout' : 'failed');
    // A timeout is explained inside the pair dialog; the scanning toast would only be stale.
    this.toast.set(code === 'timeout' ? null : this.failureToast(error));
  }

  private handlersFor(label: string): BleHandlers {
    return {
      onHeartRate: (bpm, id) => this.telemetry.ingestHeartRate(bpm, { id, label }),
      onCadence: (spm, id) => this.telemetry.ingestCadence(spm, { id, label }),
      onBattery: (percent, id) => {
        this.batteryById.set(id, percent);
        this.devices.update((list) => list.map((d) => (d.id === id ? { ...d, batteryPercent: percent } : d)));
        this.warnIfBatteryLow(id, label, percent);
      },
      onDisconnected: (id) => {
        this.markConnected(id, false);
        this.toast.set({
          severity: 'danger',
          title: `${label} disconnected`,
          message: 'The sensor dropped its Bluetooth link. Move closer and reconnect anytime.',
          action: { label: 'Reconnect', deviceId: id },
        });
      },
    };
  }

  private warnIfBatteryLow(id: string, label: string, percent: number): void {
    if (percent > LOW_BATTERY_PERCENT) {
      this.lowBatteryWarned.delete(id);
      return;
    }
    if (this.lowBatteryWarned.has(id)) {
      return;
    }
    this.lowBatteryWarned.add(id);
    this.toast.set({
      severity: 'warning',
      title: `${label} battery low (${percent}%)`,
      message: 'Charge or replace the battery soon so telemetry does not drop mid-workout.',
    });
  }

  private markConnected(id: string, connected: boolean): void {
    this.devices.update((list) => list.map((d) => (d.id === id ? { ...d, connected } : d)));
    if (connected) {
      this.telemetry.sensorConnected(id);
    } else {
      this.telemetry.sensorDisconnected(id);
    }
    this.syncCount();
  }

  private failureToast(error: unknown): DeviceToast {
    if (error instanceof BleError) {
      switch (error.code) {
        case 'cancelled':
          return { severity: 'info', title: 'Pairing cancelled', message: 'No sensor was selected.' };
        case 'unsupported':
          return {
            severity: 'danger',
            title: 'Web Bluetooth unavailable',
            message: 'Use Chrome or Edge on desktop or Android with Bluetooth turned on.',
          };
        case 'service-missing':
          return { severity: 'warning', title: 'Sensor not supported', message: error.message };
        case 'timeout':
          return { severity: 'warning', title: 'Pairing timed out', message: 'Make sure the sensor is awake and within 2 meters, then try again.' };
        default:
          return { severity: 'danger', title: 'Could not connect', message: error.message };
      }
    }
    return { severity: 'danger', title: 'Could not connect', message: 'Bluetooth pairing failed. Try again.' };
  }

  private syncCount(): void {
    this.systemStatus.linkedDeviceCount.set(this.devices().filter((d) => d.connected).length);
  }
}
