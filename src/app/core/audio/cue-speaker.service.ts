import { Injectable, OnDestroy, effect, inject } from '@angular/core';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { PreferencesStore } from '../state/preferences.store';

/** Same cue is not repeated within this window, so a steady rep stream never babbles. */
export const CUE_REPEAT_WINDOW_MS = 8000;

interface AudioContextLike {
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): {
    copyToChannel(source: Float32Array, channel: number): void;
  };
  createBufferSource(): {
    buffer: unknown;
    onended: (() => void) | null;
    connect(destination: unknown): void;
    start(): void;
    stop(): void;
  };
}

/**
 * Speaks live coaching cues. Kokoro-82M synthesizes in the ML worker; playback uses the Web Audio API.
 * Nothing is sent over the network, and switching the Settings toggle off mutes immediately (L2-009, L2-024, L2-027).
 */
@Injectable({ providedIn: 'root' })
export class CueSpeakerService implements OnDestroy {
  private readonly worker = inject(MlWorkerClient);
  private readonly prefs = inject(PreferencesStore);
  private context: AudioContextLike | null = null;
  private current: ReturnType<AudioContextLike['createBufferSource']> | null = null;
  /** Bumped on every mute; synthesis finishing for an older generation is discarded. */
  private generation = 0;
  private busy = false;
  private lastCue = '';
  private lastCueAt = 0;

  constructor() {
    effect(() => {
      if (!this.prefs.preferences().kokoroTtsEnabled) {
        this.mute();
      }
    });
  }

  get enabled(): boolean {
    return this.prefs.preferences().kokoroTtsEnabled;
  }

  /** Synthesizes and plays one cue. Returns whether audio actually played. */
  async speak(text: string, now: number = Date.now()): Promise<boolean> {
    if (!this.enabled || this.busy) {
      return false;
    }
    if (text === this.lastCue && now - this.lastCueAt < CUE_REPEAT_WINDOW_MS) {
      return false;
    }
    this.lastCue = text;
    this.lastCueAt = now;
    this.busy = true;
    const generation = this.generation;
    try {
      const result = await this.worker.synthesizeCue(text);
      if (!result.samples || generation !== this.generation || !this.enabled) {
        return false;
      }
      return await this.play(result.samples, result.sampleRate, generation);
    } finally {
      this.busy = false;
    }
  }

  /** Stops current playback and discards any synthesis still in flight. */
  mute(): void {
    this.generation += 1;
    try {
      this.current?.stop();
    } catch {
      // Already stopped.
    }
    this.current = null;
  }

  private async play(samples: Float32Array, sampleRate: number, generation: number): Promise<boolean> {
    const Ctor = (globalThis as unknown as { AudioContext?: new () => AudioContextLike }).AudioContext;
    if (!Ctor) {
      return false;
    }
    this.context ??= new Ctor();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    if (generation !== this.generation || !this.enabled) {
      return false;
    }
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.current = source;
    source.onended = () => {
      if (this.current === source) {
        this.current = null;
      }
    };
    source.start();
    return true;
  }

  ngOnDestroy(): void {
    this.mute();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
