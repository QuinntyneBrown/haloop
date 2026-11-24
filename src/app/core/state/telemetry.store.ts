import { Injectable, computed, signal } from '@angular/core';

export type HeartRateZone = 1 | 2 | 3 | 4 | 5;

/** Used when no age is configured; Zone boundaries are percentages of this maximum. */
export const DEFAULT_MAX_HEART_RATE = 190;

/** Zone 1 < 60 % ≤ Zone 2 < 70 % ≤ Zone 3 < 80 % ≤ Zone 4 < 90 % ≤ Zone 5 of maximum heart rate. */
export function heartRateZone(bpm: number, maxHeartRate = DEFAULT_MAX_HEART_RATE): HeartRateZone {
  const ratio = bpm / maxHeartRate;
  if (ratio < 0.6) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 0.8) return 3;
  if (ratio < 0.9) return 4;
  return 5;
}

/** Plausible human range; anything outside is a sensor glitch and is ignored. */
const MIN_BPM = 30;
const MAX_BPM = 240;
const MAX_CADENCE = 260;

export interface TelemetrySource {
  readonly id: string;
  readonly label: string;
}

/**
 * Live wearable telemetry (heart rate, cadence) shared by Devices and Train. Sensor notifications are
 * ingested here; nothing leaves the browser (L2-009, L2-018, L2-027). A disconnected sensor clears its own
 * readings only, so rep counting and session saving carry on without it.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryStore {
  readonly heartRate = signal<number | null>(null);
  readonly heartRateSource = signal<TelemetrySource | null>(null);
  readonly cadence = signal<number | null>(null);
  readonly cadenceSource = signal<TelemetrySource | null>(null);
  readonly maxHeartRate = signal<number>(DEFAULT_MAX_HEART_RATE);

  readonly zone = computed<HeartRateZone | null>(() => {
    const bpm = this.heartRate();
    return bpm === null ? null : heartRateZone(bpm, this.maxHeartRate());
  });

  private readonly lastKnown = new Map<string, { kind: 'hr' | 'cadence'; value: number; label: string }>();
  private sum = 0;
  private count = 0;

  ingestHeartRate(bpm: number, source: TelemetrySource): void {
    if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
      return;
    }
    const value = Math.round(bpm);
    this.lastKnown.set(source.id, { kind: 'hr', value, label: source.label });
    this.heartRate.set(value);
    this.heartRateSource.set(source);
  }

  ingestCadence(stepsPerMinute: number, source: TelemetrySource): void {
    if (!Number.isFinite(stepsPerMinute) || stepsPerMinute < 0 || stepsPerMinute > MAX_CADENCE) {
      return;
    }
    const value = Math.round(stepsPerMinute);
    this.lastKnown.set(source.id, { kind: 'cadence', value, label: source.label });
    this.cadence.set(value);
    this.cadenceSource.set(source);
  }

  /** A sensor dropped: clear only what it was providing. */
  sensorDisconnected(id: string): void {
    if (this.heartRateSource()?.id === id) {
      this.heartRate.set(null);
      this.heartRateSource.set(null);
    }
    if (this.cadenceSource()?.id === id) {
      this.cadence.set(null);
      this.cadenceSource.set(null);
    }
  }

  /** A sensor came back: resume from its last reading until a fresh notification arrives. */
  sensorConnected(id: string): void {
    const last = this.lastKnown.get(id);
    if (!last) {
      return;
    }
    const source = { id, label: last.label };
    if (last.kind === 'hr') {
      this.ingestHeartRate(last.value, source);
    } else {
      this.ingestCadence(last.value, source);
    }
  }

  /** Adds the current reading to the running session average; call about once a second while training. */
  sample(): void {
    const bpm = this.heartRate();
    if (bpm !== null) {
      this.sum += bpm;
      this.count += 1;
    }
  }

  /** Mean heart rate recorded this workout, or `null` when no sensor was connected. */
  averageBpm(): number | null {
    return this.count === 0 ? null : Math.round(this.sum / this.count);
  }

  resetSession(): void {
    this.sum = 0;
    this.count = 0;
  }
}
