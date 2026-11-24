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

export type SensorKind = 'heart-rate' | 'running';

export type BleErrorCode = 'unsupported' | 'cancelled' | 'connect-failed' | 'service-missing' | 'timeout';

export type AdapterStatus = 'available' | 'off' | 'unsupported';

export class BleError extends Error {
  constructor(
    readonly code: BleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BleError';
  }
}

export interface BleHandlers {
  onHeartRate?(bpm: number, deviceId: string): void;
  onCadence?(stepsPerMinute: number, deviceId: string): void;
  onBattery?(percent: number, deviceId: string): void;
  /** Fired for an unexpected `gattserverdisconnected` (not for a user-initiated `disconnect()`). */
  onDisconnected?(deviceId: string): void;
}

export interface BleConnection {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly kind: SensorKind;
  disconnect(): void;
  /** Re-opens the GATT connection and notifications on the same device (no chooser needed in the same session). */
  reconnect(): Promise<void>;
}

interface GattCharacteristic extends EventTarget {
  readonly value?: DataView;
  startNotifications(): Promise<GattCharacteristic>;
  readValue(): Promise<DataView>;
}

interface GattService {
  getCharacteristic(characteristic: string | number): Promise<GattCharacteristic>;
}

interface GattServer {
  readonly connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<GattService>;
}

interface BleDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: GattServer;
}

interface BluetoothNavigator {
  bluetooth?: {
    getAvailability?(): Promise<boolean>;
    requestDevice(options: {
      filters: { services: (string | number)[] }[];
      optionalServices?: (string | number)[];
    }): Promise<BleDevice>;
  };
}

const PRIMARY_SERVICE: Record<SensorKind, string> = {
  'heart-rate': 'heart_rate',
  running: 'running_speed_and_cadence',
};

@Injectable({ providedIn: 'root' })
export class WebBluetoothAdapter {
  private nav(): BluetoothNavigator | undefined {
    return typeof navigator !== 'undefined' ? (navigator as unknown as BluetoothNavigator) : undefined;
  }

  /** `unsupported` = no Web Bluetooth API in this browser; `off` = the API exists but the radio is unavailable. */
  async status(): Promise<AdapterStatus> {
    if (!this.nav()?.bluetooth) {
      return 'unsupported';
    }
    return (await this.isAdapterAvailable()) ? 'available' : 'off';
  }

  async isAdapterAvailable(): Promise<boolean> {
    const nav = this.nav();
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

  /**
   * Asks the user to choose a sensor (this MUST be called from a click handler), connects to its GATT server and
   * streams parsed notifications to `handlers`. Everything stays in the browser (L2-018, L2-027).
   */
  async connect(kind: SensorKind, handlers: BleHandlers): Promise<BleConnection> {
    const bluetooth = this.nav()?.bluetooth;
    if (!bluetooth) {
      throw new BleError('unsupported', 'Web Bluetooth is not available in this browser.');
    }
    let device: BleDevice;
    try {
      device = await bluetooth.requestDevice({
        filters: [{ services: [PRIMARY_SERVICE[kind]] }],
        optionalServices: ['battery_service', 'heart_rate', 'running_speed_and_cadence'],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new BleError('cancelled', 'No sensor was selected.');
      }
      throw new BleError('connect-failed', describe(error));
    }

    let intentionalDisconnect = false;
    device.addEventListener('gattserverdisconnected', () => {
      if (!intentionalDisconnect) {
        handlers.onDisconnected?.(device.id);
      }
    });

    const open = async (): Promise<void> => {
      intentionalDisconnect = false;
      const server = await device.gatt?.connect();
      if (!server) {
        throw new BleError('connect-failed', 'The sensor has no GATT server.');
      }
      await this.subscribe(server, kind, handlers, device.id);
    };

    try {
      await open();
    } catch (error) {
      device.gatt?.disconnect();
      throw error instanceof BleError ? error : new BleError('connect-failed', describe(error));
    }

    return {
      deviceId: device.id,
      deviceName: device.name ?? (kind === 'heart-rate' ? 'BLE Heart Rate Sensor' : 'BLE Running Sensor'),
      kind,
      disconnect: () => {
        intentionalDisconnect = true;
        device.gatt?.disconnect();
      },
      reconnect: async () => {
        try {
          await open();
        } catch (error) {
          throw error instanceof BleError ? error : new BleError('connect-failed', describe(error));
        }
      },
    };
  }

  private async subscribe(server: GattServer, kind: SensorKind, handlers: BleHandlers, deviceId: string): Promise<void> {
    const notify = async (
      service: string,
      characteristic: string,
      onValue: (value: DataView) => void,
    ): Promise<void> => {
      const char = await (await server.getPrimaryService(service)).getCharacteristic(characteristic);
      char.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as GattCharacteristic | null)?.value;
        if (value) onValue(value);
      });
      await char.startNotifications();
    };

    try {
      if (kind === 'heart-rate') {
        await notify('heart_rate', 'heart_rate_measurement', (v) => handlers.onHeartRate?.(parseBleHeartRateMeasurement(v), deviceId));
      } else {
        await notify('running_speed_and_cadence', 'rsc_measurement', (v) => handlers.onCadence?.(parseBleRunningCadence(v), deviceId));
      }
    } catch (error) {
      throw new BleError('service-missing', `The sensor does not provide the expected data: ${describe(error)}`);
    }

    // Battery is optional: many sensors do not expose it.
    try {
      const battery = await (await server.getPrimaryService('battery_service')).getCharacteristic('battery_level');
      handlers.onBattery?.(parseBleBatteryLevel(await battery.readValue()), deviceId);
      battery.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as GattCharacteristic | null)?.value;
        if (value) handlers.onBattery?.(parseBleBatteryLevel(value), deviceId);
      });
      await battery.startNotifications().catch(() => undefined);
    } catch {
      // No battery service.
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
