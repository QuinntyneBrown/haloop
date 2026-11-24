import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { MlWorkerClient } from '../ai/ml-worker.client';
import { PreferencesStore } from '../state/preferences.store';

export type VoiceCommand = 'next-set' | 'pause' | 'resume' | 'finish';
export type VoiceState = 'off' | 'starting' | 'listening' | 'blocked' | 'unsupported';

export const VOICE_SAMPLE_RATE = 16000;

/** Mean-square level above which a chunk counts as speech. */
const SPEECH_RMS = 0.015;
const SILENCE_END_SECONDS = 0.7;
const MAX_UTTERANCE_SECONDS = 6;
const MIN_UTTERANCE_SECONDS = 0.3;
const PRE_ROLL_CHUNKS = 2;

/**
 * Energy-based utterance segmenter: collects audio from the first speech chunk until a short silence
 * (or a hard cap) and emits the whole utterance for transcription, so Whisper only ever hears speech.
 */
export class UtteranceSegmenter {
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private speaking = false;
  private silentSamples = 0;
  private total = 0;

  constructor(
    private readonly onUtterance: (samples: Float32Array) => void,
    private readonly sampleRate = VOICE_SAMPLE_RATE,
  ) {}

  push(chunk: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const loud = chunk.length > 0 && Math.sqrt(sum / chunk.length) > SPEECH_RMS;

    if (!this.speaking) {
      if (!loud) {
        this.preRoll.push(chunk);
        if (this.preRoll.length > PRE_ROLL_CHUNKS) this.preRoll.shift();
        return;
      }
      this.speaking = true;
      this.chunks = [...this.preRoll];
      this.total = this.chunks.reduce((n, c) => n + c.length, 0);
      this.preRoll = [];
      this.silentSamples = 0;
    }

    this.chunks.push(chunk);
    this.total += chunk.length;
    this.silentSamples = loud ? 0 : this.silentSamples + chunk.length;

    if (this.silentSamples >= SILENCE_END_SECONDS * this.sampleRate || this.total >= MAX_UTTERANCE_SECONDS * this.sampleRate) {
      this.flush();
    }
  }

  reset(): void {
    this.chunks = [];
    this.preRoll = [];
    this.speaking = false;
    this.silentSamples = 0;
    this.total = 0;
  }

  private flush(): void {
    const samples = new Float32Array(this.total);
    let offset = 0;
    for (const c of this.chunks) {
      samples.set(c, offset);
      offset += c.length;
    }
    const enough = this.total >= MIN_UTTERANCE_SECONDS * this.sampleRate;
    this.reset();
    if (enough) {
      this.onUtterance(samples);
    }
  }
}

/** Maps a Whisper transcript to a workout command. Unrelated speech maps to `null`. */
export function matchCommand(transcript: string): VoiceCommand | null {
  const t = transcript.toLowerCase();
  if (/\b(pause|hold on|stop)\b/.test(t)) return 'pause';
  if (/\b(resume|continue|keep going|start)\b/.test(t)) return 'resume';
  if (/\b(finish|done|end (the )?(session|workout))\b/.test(t)) return 'finish';
  if (/\bnext( set)?\b/.test(t)) return 'next-set';
  return null;
}

const WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('haloop-capture', CaptureProcessor);
`;

interface AudioContextLike {
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  readonly destination: unknown;
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void; disconnect(): void };
  close(): Promise<void>;
}

/**
 * Hands-free workout commands. The microphone opens only from an explicit user gesture, audio is
 * transcribed by Whisper in the ML worker, and nothing is uploaded (L2-009, L2-027, L2-030).
 */
@Injectable({ providedIn: 'root' })
export class VoiceCommandService implements OnDestroy {
  private readonly worker = inject(MlWorkerClient);
  private readonly prefs = inject(PreferencesStore);

  readonly state = signal<VoiceState>('off');
  /** Last heard phrase, shown so the user can see what Whisper understood. */
  readonly lastHeard = signal<string>('');

  private stream: MediaStream | null = null;
  private context: AudioContextLike | null = null;
  private workletUrl: string | null = null;
  private segmenter: UtteranceSegmenter | null = null;
  private handler: ((command: VoiceCommand) => void) | null = null;
  /** Bumped on every stop so transcripts finishing after a stop are ignored. */
  private session = 0;

  /** Opens the microphone. Must be called from a click or key handler. */
  async start(onCommand: (command: VoiceCommand) => void): Promise<boolean> {
    if (this.state() === 'listening' || this.state() === 'starting') {
      this.handler = onCommand;
      return true;
    }
    const AudioCtor = (globalThis as unknown as { AudioContext?: new (o?: { sampleRate: number }) => AudioContextLike })
      .AudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioCtor || typeof AudioWorkletNode === 'undefined') {
      this.state.set('unsupported');
      return false;
    }
    this.state.set('starting');
    const session = ++this.session;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
      const context = new AudioCtor({ sampleRate: VOICE_SAMPLE_RATE });
      this.context = context;
      this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      await context.audioWorklet.addModule(this.workletUrl);
      if (session !== this.session) {
        this.stop();
        return false;
      }
      const source = context.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(context as unknown as BaseAudioContext, 'haloop-capture');
      this.handler = onCommand;
      this.segmenter = new UtteranceSegmenter((samples) => void this.handleUtterance(samples, session));
      node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => this.segmenter?.push(data);
      source.connect(node);
      this.state.set('listening');
      return true;
    } catch {
      this.stop();
      this.state.set('blocked');
      return false;
    }
  }

  /** Releases the microphone and discards any audio still being transcribed. */
  stop(): void {
    this.session += 1;
    this.segmenter?.reset();
    this.segmenter = null;
    this.handler = null;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    if (this.state() === 'listening' || this.state() === 'starting') {
      this.state.set('off');
    }
  }

  /** Transcribes one utterance in the worker and dispatches the recognized command. */
  async handleUtterance(samples: Float32Array, session = this.session): Promise<VoiceCommand | null> {
    const result = await this.worker.transcribeAudio(samples, this.prefs.preferences().preferredBackend);
    if (session !== this.session || !result.text) {
      return null;
    }
    this.lastHeard.set(result.text);
    const command = matchCommand(result.text);
    if (command) {
      this.handler?.(command);
    }
    return command;
  }

  ngOnDestroy(): void {
    this.stop();
  }
}
