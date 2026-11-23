import { Injectable, inject, signal } from '@angular/core';
import { SystemStatusStore } from './system-status.store';
import { validateDeviceLabel } from '../security/sanitize';

export interface WearableDevice {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly batteryPercent: number;
  readonly connected: boolean;
}

export interface DeviceToast {
  readonly severity: 'info' | 'success' | 'warning' | 'danger';
  readonly title: string;
  readonly message: string;
}

const INITIAL_DEVICES: readonly WearableDevice[] = [
  {
    id: 'polar-h10',
    label: 'Polar H10',
    role: 'Heart-rate chest strap · 72 bpm resting',
    batteryPercent: 88,
    connected: true,
  },
  {
    id: 'coros-pace-3',
    label: 'Coros Pace 3',
    role: 'Running watch · Cadence & pace',
    batteryPercent: 64,
    connected: true,
  },
];

@Injectable({ providedIn: 'root' })
export class BluetoothDeviceStore {
  private readonly systemStatus = inject(SystemStatusStore);

  readonly devices = signal<readonly WearableDevice[]>(INITIAL_DEVICES);
  readonly toast = signal<DeviceToast | null>(null);
  readonly pairingBusy = signal<boolean>(false);

  async pairSensor(sensorId: string, customLabel: string, role: string): Promise<string | null> {
    const err = validateDeviceLabel(customLabel);
    if (err) {
      return err;
    }
    this.pairingBusy.set(true);
    this.toast.set({
      severity: 'info',
      title: 'Scanning for Bluetooth sensors',
      message: 'Keep your heart-rate strap awake within 2 meters.',
    });

    await new Promise((r) => setTimeout(r, 200));

    const cleanLabel = customLabel.trim();
    const next: WearableDevice = {
      id: `${sensorId}-${Date.now()}`,
      label: cleanLabel,
      role,
      batteryPercent: 92,
      connected: true,
    };
    this.devices.update((list) => [...list, next]);
    this.syncCount();
    this.pairingBusy.set(false);
    this.toast.set({
      severity: 'success',
      title: `${cleanLabel} connected`,
      message: 'Live heart rate is now streaming to Train.',
    });
    return null;
  }

  toggleConnection(id: string): void {
    let changed: WearableDevice | undefined;
    this.devices.update((list) =>
      list.map((d) => {
        if (d.id !== id) return d;
        changed = { ...d, connected: !d.connected };
        return changed;
      }),
    );
    this.syncCount();
    if (changed) {
      this.toast.set(
        changed.connected
          ? {
              severity: 'success',
              title: `${changed.label} connected`,
              message: 'Live telemetry resumed.',
            }
          : {
              severity: 'danger',
              title: `${changed.label} disconnected`,
              message: 'Signal disconnected. Move closer and reconnect anytime.',
            },
      );
    }
  }

  dismissToast(): void {
    this.toast.set(null);
  }

  private syncCount(): void {
    this.systemStatus.linkedDeviceCount.set(this.devices().filter((d) => d.connected).length);
  }
}
