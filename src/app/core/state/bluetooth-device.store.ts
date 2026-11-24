import { Injectable, inject, signal } from '@angular/core';
import { BleConnection, BleError, BleHandlers, SensorKind, WebBluetoothAdapter } from '../wearables/web-bluetooth.adapter';
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
}

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

  readonly devices = signal<readonly WearableDevice[]>(INITIAL_DEVICES);
  readonly toast = signal<DeviceToast | null>(null);
  readonly pairingBusy = signal<boolean>(false);

  private readonly connections = new Map<string, BleConnection>();
  /** Battery reported while the device is still being added to the list. */
  private readonly batteryById = new Map<string, number>();

  constructor() {
    // The default device list mirrors a paired Polar H10 strap that is already streaming (matches the mocks);
    // live GATT notifications replace these readings as soon as a sensor reports.
    this.telemetry.ingestHeartRate(134, { id: 'polar-h10', label: 'Polar H10' });
    void this.restore();
  }

  /** Reloads paired-device metadata. A page reload drops every GATT link, so all devices start Disconnected. */
  private async restore(): Promise<void> {
    let saved: PersistedDevice[] | null = null;
    try {
      saved = await this.db.get<PersistedDevice[]>('devices');
    } catch {
      return;
    }
    if (!saved || saved.length === 0 || this.devices().some((d) => !INITIAL_DEVICES.some((i) => i.id === d.id))) {
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
    this.toast.set({
      severity: 'info',
      title: 'Scanning for Bluetooth sensors',
      message: 'Choose your sensor in the browser prompt and keep it awake within 2 meters.',
    });

    try {
      const connection = await this.adapter.connect(kind, this.handlersFor(cleanLabel));
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
      this.toast.set({
        severity: 'success',
        title: `${cleanLabel} connected`,
        message: kind === 'heart-rate' ? 'Live heart rate is now streaming to Train.' : 'Live cadence is now streaming to Train.',
      });
    } catch (error) {
      this.toast.set(this.failureToast(error));
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
      });
      return;
    }

    this.pairingBusy.set(true);
    try {
      const existing = this.connections.get(id);
      if (existing) {
        await existing.reconnect();
      } else {
        // After a reload (or for a demo device) the browser needs the user to pick the sensor again.
        const connection = await this.adapter.connect(device.kind, this.handlersFor(device.label));
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
      this.toast.set(this.failureToast(error));
    } finally {
      this.pairingBusy.set(false);
    }
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  private handlersFor(label: string): BleHandlers {
    return {
      onHeartRate: (bpm, id) => this.telemetry.ingestHeartRate(bpm, { id, label }),
      onCadence: (spm, id) => this.telemetry.ingestCadence(spm, { id, label }),
      onBattery: (percent, id) => {
        this.batteryById.set(id, percent);
        this.devices.update((list) => list.map((d) => (d.id === id ? { ...d, batteryPercent: percent } : d)));
      },
      onDisconnected: (id) => {
        this.markConnected(id, false);
        this.toast.set({
          severity: 'danger',
          title: `${label} disconnected`,
          message: 'The sensor dropped its Bluetooth link. Move closer and reconnect anytime.',
        });
      },
    };
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
