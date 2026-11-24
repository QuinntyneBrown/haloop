import { Injectable } from '@angular/core';

/**
 * Parses standard Bluetooth Low Energy Heart Rate Measurement (0x2A37) payload.
 * Bit 0 of flags indicates UINT8 (0) vs UINT16 (1) heart-rate format.
 */
export function parseBleHeartRateMeasurement(data: DataView): number {
  if (data.byteLength < 2) {
    return 0;
  }
  const flags = data.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  if (is16Bit && data.byteLength >= 3) {
    return data.getUint16(1, true);
  }
  return data.getUint8(1);
}

/**
 * Parses standard BLE Battery Level (0x2A19) characteristic (0-100%).
 */
export function parseBleBatteryLevel(data: DataView): number {
  if (data.byteLength < 1) {
    return 0;
  }
  return Math.min(100, Math.max(0, data.getUint8(0)));
}

/**
 * Parses the cadence (steps per minute) from a Running Speed and Cadence Measurement (0x2A53) payload:
 * flags (uint8), instantaneous speed (uint16, 1/256 m/s), instantaneous cadence (uint8).
 */
export function parseBleRunningCadence(data: DataView): number {
  if (data.byteLength < 4) {
    return 0;
  }
  return data.getUint8(3);
}

interface BluetoothNavigator {
  bluetooth?: {
    getAvailability?(): Promise<boolean>;
    requestDevice(options: {
      filters: { services: (string | number)[] }[];
      optionalServices?: (string | number)[];
    }): Promise<{ id: string; name?: string }>;
  };
}

@Injectable({ providedIn: 'root' })
export class WebBluetoothAdapter {
  async isAdapterAvailable(): Promise<boolean> {
    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as BluetoothNavigator) : undefined;
    if (!nav?.bluetooth) {
      return false;
    }
    if (nav.bluetooth.getAvailability) {
      try {
        return await nav.bluetooth.getAvailability();
      } catch {
        return false;
      }
    }
    return true;
  }

  async requestHeartRateDevice(): Promise<{ id: string; name: string } | null> {
    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as BluetoothNavigator) : undefined;
    if (!nav?.bluetooth) {
      return null;
    }
    const dev = await nav.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service', 'running_speed_and_cadence'],
    });
    return { id: dev.id, name: dev.name ?? 'BLE Heart Rate Sensor' };
  }
}
