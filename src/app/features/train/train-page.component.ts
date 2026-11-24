import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MlWorkerClient } from '../../core/ai/ml-worker.client';
import { CueSpeakerService } from '../../core/audio/cue-speaker.service';
import { VoiceCommand, VoiceCommandService } from '../../core/audio/voice-command.service';
import { PreferencesStore } from '../../core/state/preferences.store';
import { WorkoutHistoryStore } from '../../core/state/workout-history.store';
import { WorkoutPlanStore } from '../../core/state/workout-plan.store';
import { BluetoothDeviceStore } from '../../core/state/bluetooth-device.store';
import { TelemetryStore } from '../../core/state/telemetry.store';
import {
  MORNING_STRENGTH_PLAN,
  SETS_PER_MOVEMENT,
  WorkoutSessionStore,
} from '../../core/state/workout-session.store';
import { validateReflectionNote } from '../../core/security/sanitize';
import { SKELETON_EDGES, SquatRepTracker } from '../../core/pose/pose-math';
import { PoseFrameUpdate, PoseSession, mapKeypointToDisplay } from '../../core/pose/pose-session';

type WorkoutPhase = 'active' | 'paused' | 'camera-blocked';

const AUDIO_ONLY_CUES: readonly string[] = [
  'Chest proud, smooth descent.',
  'Control the tempo: three down, one pause, one up.',
  'Brace your core and keep your knees tracking over your toes.',
  'Steady breathing. You are doing great.',
];

@Component({
  selector: 'app-train-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    @if (warmingUp()) {
      <div class="stack" role="status" aria-busy="true" aria-label="Loading on-device models" data-testid="train-loading">
        <div class="stack stack--sm">
          <span class="skeleton skeleton--text" style="width:40%;"></span>
          <span class="skeleton skeleton--text" style="width:65%;"></span>
        </div>
        <div class="skeleton skeleton--rect" style="height:20rem;width:100%;"></div>
        <div class="kpi-grid">
          @for (n of [1, 2, 3]; track n) {
            <div class="card stack stack--sm">
              <span class="skeleton skeleton--text" style="width:50%;"></span>
              <span class="skeleton skeleton--title"></span>
            </div>
          }
        </div>
        <p class="text-muted">Warming up VitPose, Whisper and Kokoro on this device…</p>
      </div>
    } @else if (session.stage() === 'idle') {
      <div class="empty" data-testid="train-empty">
        <div class="empty__icon" aria-hidden="true">
          <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
        </div>
        <h2 class="empty__title">Ready to train on-device</h2>
        <p class="empty__text">Pick a guided workout or start a free-form session. Pose estimation runs locally on your GPU—video never leaves this tab.</p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="startWorkout()" data-testid="train-start-workout">
            <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4" /></svg>
            Start Morning Strength
          </button>
          <a class="btn btn--pill" routerLink="/coach">Ask Coach for a plan</a>
        </div>
      </div>
    } @else {
    <div class="cluster cluster--between">
      <div>
        <p class="overline">Morning Strength &amp; Mobility · Set {{ setNumber() }} of {{ totalSets }}</p>
        <p class="text-muted" style="margin-top:var(--space-1);">
          {{ movement().name }} · VitPose {{ backendLabel() }} (30 fps) · Whisper voice commands listening
        </p>
      </div>
      <div class="cluster">
        @if (phase() === 'active') {
          <button type="button" class="btn btn--pill" (click)="pause()" data-testid="train-pause">
            <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            Pause
          </button>
        } @else {
          <button type="button" class="btn btn--pill" (click)="resume()" data-testid="train-resume">
            <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4" /></svg>
            Resume session
          </button>
        }
        <button type="button" class="btn btn--primary btn--pill" (click)="openFinishDialog()" data-testid="train-finish">
          Finish session
        </button>
      </div>
    </div>

    @if (plan.adjustment(); as adj) {
      <section class="alert" role="status" aria-live="polite" data-testid="train-adjustment-banner">
        <strong>Coach adjustment applied · {{ plan.loadLabel() }}</strong>
        <p>Start with {{ adj.warmUp.durationSeconds }} seconds of {{ adj.warmUp.label.toLowerCase() }} before your first set.</p>
        <button type="button" class="btn btn--sm btn--ghost" (click)="plan.clear()" data-testid="train-adjustment-dismiss">Dismiss</button>
      </section>
    }

    @if (phase() === 'paused') {
      <section class="alert alert--warning" role="status" aria-live="polite" data-testid="train-paused-banner">
        <strong>Session paused at {{ formattedElapsed() }}</strong>
        <p>Camera tracking is paused. Resume when you’re ready, or finish and save your completed sets.</p>
      </section>
    }

    @if (phase() === 'camera-blocked') {
      <section class="empty" role="alert">
        <h2 class="empty__title">Camera permission blocked</h2>
        <p class="empty__text">
          Haloop needs local camera access to count reps with VitPose. You can allow camera access in Chrome’s address
          bar or continue with audio-only coaching.
        </p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="requestCamera()">Try camera again</button>
          <button type="button" class="btn btn--pill" (click)="continueAudioOnly()" data-testid="train-audio-only">
            Continue audio-only
          </button>
          <a class="btn btn--pill" routerLink="/lab">Check AI Lab models</a>
        </div>
      </section>
    } @else {
      <section class="camera-stage" aria-label="Live pose estimation camera preview">
        @if (cameraActive()) {
          <video
            #video
            class="camera-stage__video"
            autoplay
            playsinline
            muted
            aria-label="Local camera preview"
            data-testid="train-video"
          ></video>
          <canvas #overlay class="camera-stage__overlay" aria-hidden="true" data-testid="train-pose-overlay"></canvas>
        }
        <div class="camera-stage__hud">
          <span class="camera-stage__pill">
            <span class="status-dot status-dot--live" aria-hidden="true"></span>
            Camera local · never uploaded
          </span>
          <div class="cluster" style="gap:var(--space-2);">
            <span class="camera-stage__pill">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                <path
                  d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                />
              </svg>
              <span data-testid="train-hud-hr">{{ heartRateLabel() }}</span>
            </span>
            @if (voice.state() === 'listening') {
              <span class="camera-stage__pill" role="status" data-testid="train-voice-status">
                <span class="status-dot status-dot--live" aria-hidden="true"></span>
                Listening · say “Next set”, “Pause”, “Resume” or “Finish”
              </span>
            } @else {
              <button
                type="button"
                class="camera-stage__pill"
                (click)="enableVoice()"
                [disabled]="voice.state() === 'starting' || voice.state() === 'unsupported'"
                data-testid="train-enable-voice"
              >
                <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                {{ voiceButtonLabel() }}
              </button>
            }
            @if (poseStatus(); as status) {
              <span class="camera-stage__pill" role="status" data-testid="train-pose-status">{{ status }}</span>
            }
          </div>
        </div>
        <div class="camera-stage__center">
          <span class="overline" style="color:var(--color-sidebar-muted);" data-testid="train-movement">{{ movement().name }}</span>
          <div class="camera-stage__reps" aria-live="polite" data-testid="train-reps">{{ reps() }} / {{ movement().targetReps }}</div>
          <p class="text-sm" style="color:var(--color-sidebar-fg);">“{{ activeCue() }}”</p>
          <div class="cluster" style="margin-top:var(--space-2); justify-content:center;">
            <button
              type="button"
              class="btn btn--sm btn--pill"
              (click)="logRep()"
              [disabled]="phase() !== 'active'"
              data-testid="train-log-rep"
            >
              + Count rep (VitPose Worker)
            </button>
            <button
              type="button"
              class="btn btn--sm btn--pill"
              (click)="nextSet()"
              [disabled]="phase() !== 'active'"
              data-testid="train-next-set"
            >
              {{ isLastSet() ? 'Finish workout' : 'Next set' }}
            </button>
            <button
              type="button"
              class="btn btn--sm btn--ghost"
              style="color:var(--color-sidebar-fg);"
              (click)="requestCamera()"
              data-testid="train-enable-camera"
            >
              {{ cameraActive() ? 'Camera active' : 'Enable webcam' }}
            </button>
          </div>
        </div>
        <div class="camera-stage__hud">
          <span class="camera-stage__pill">Form score: {{ formScore() }}%</span>
          <span class="camera-stage__pill">Elapsed {{ formattedElapsed() }}</span>
        </div>
      </section>

      <section class="kpi-grid">
        <div class="card stat">
          <span class="stat__label">Heart rate</span>
          <span class="stat__value" data-testid="train-kpi-hr">{{ heartRate() === null ? '—' : heartRate() + ' bpm' }}</span>
          <span class="stat__delta text-muted" data-testid="train-kpi-hr-source">{{ heartRateCaption() }}</span>
        </div>
        <div class="card stat">
          <span class="stat__label">Cadence</span>
          @if (telemetry.cadence(); as spm) {
            <span class="stat__value" data-testid="train-kpi-cadence">{{ spm }} spm</span>
            <span class="stat__delta text-muted">{{ telemetry.cadenceSource()?.label }} · Live</span>
          } @else {
            <span class="stat__value">3-1-1</span>
            <span class="stat__delta stat__delta--up">On target tempo</span>
          }
        </div>
        <div class="card stat">
          <span class="stat__label">Up next</span>
          <span class="stat__value" style="font-size:var(--font-size-lg);" data-testid="train-up-next">{{ upNext().name }}</span>
          <span class="stat__delta text-muted">{{ upNext().detail }}</span>
        </div>
      </section>
    }

    }

    @if (finishDialogOpen()) {
      <div class="backdrop" (click)="closeFinishDialog()"></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-workout-title"
        aria-describedby="end-workout-desc"
        (keydown.escape)="closeFinishDialog()"
        data-testid="end-workout-dialog"
      >
        <div class="dialog__panel">
          <div class="dialog__header">
            <div class="dialog__icon dialog__icon--info" aria-hidden="true">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <div style="flex:1;">
              <h2 class="dialog__title" id="end-workout-title">Finish workout?</h2>
              <p id="end-workout-desc" class="text-sm text-muted" style="margin-top:var(--space-1);">
                Your reps, form score, and heart-rate summary will be saved locally.
              </p>
            </div>
            <button
              type="button"
              class="btn btn--ghost btn--icon btn--sm"
              aria-label="Close dialog"
              (click)="closeFinishDialog()"
            >
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="dialog__body stack">
            @if (saveError(); as saveFailure) {
              <div class="alert alert--danger" role="alert" data-testid="end-workout-save-error">
                <svg class="icon" aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div class="alert__body">
                  <div class="alert__title">Could not save session</div>
                  <p class="text-sm">
                    @if (saveFailure === 'quota') {
                      Local storage quota is full. Free space in
                      <a routerLink="/lab" data-testid="end-workout-open-lab">AI Lab</a> or retry saving. Your note is kept.
                    } @else {
                      Something went wrong saving to local storage. Retry saving; your note is kept.
                    }
                  </p>
                </div>
              </div>
            }
            <div class="well cluster cluster--between">
              <span class="text-sm"><strong>{{ formattedElapsed() }}</strong> elapsed</span>
              <span class="text-sm"><strong>{{ totalSessionReps() }}</strong> reps</span>
              <span class="text-sm"><strong>{{ formScore() }}%</strong> form</span>
            </div>

            <label class="field">
              <span class="field__label">
                Devotional or training note <span class="optional">(optional, max 280 chars)</span>
              </span>
              <textarea
                class="textarea"
                rows="3"
                name="reflectionNote"
                [ngModel]="reflectionNote()"
                (ngModelChange)="reflectionNote.set($event)"
                [attr.aria-invalid]="noteError() ? 'true' : null"
                data-testid="end-workout-note"
              ></textarea>
              @if (noteError(); as err) {
                <span class="field__error" role="alert" data-testid="end-workout-note-error">{{ err }}</span>
              }
            </label>
          </div>

          <div class="dialog__footer">
            <button type="button" class="btn btn--pill" (click)="closeFinishDialog()" [disabled]="saving()">
              Keep training
            </button>
            <button
              type="button"
              class="btn btn--primary btn--pill"
              (click)="saveSession()"
              [disabled]="saving()"
              data-testid="end-workout-save"
            >
              {{ saving() ? 'Saving…' : 'Save session' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class TrainPageComponent implements OnDestroy {
  protected readonly plan = inject(WorkoutPlanStore);
  private readonly speaker = inject(CueSpeakerService);
  protected readonly voice = inject(VoiceCommandService);
  private readonly history = inject(WorkoutHistoryStore);
  private readonly mlWorker = inject(MlWorkerClient);
  private readonly prefs = inject(PreferencesStore);
  private readonly router = inject(Router);

  protected readonly phase = signal<WorkoutPhase>('active');
  protected readonly reps = signal<number>(8);
  protected readonly formScore = signal<number>(95);
  /** Injected so the paired-device list is registered and its sensors are streaming into telemetry. */
  protected readonly devices = inject(BluetoothDeviceStore);
  protected readonly telemetry = inject(TelemetryStore);
  protected readonly heartRate = this.telemetry.heartRate;
  protected readonly elapsedSeconds = signal<number>(702);
  protected readonly activeCue = signal<string>('Chest proud, smooth descent — great knee tracking.');
  protected readonly cameraActive = signal<boolean>(false);
  protected readonly finishDialogOpen = signal<boolean>(false);
  protected readonly reflectionNote = signal<string>(
    'Felt steady after warming up my calves. Grateful for unhurried focus this morning.',
  );
  protected readonly noteError = signal<string | null>(null);
  protected readonly saving = signal<boolean>(false);

  protected readonly poseStatus = signal<string | null>(null);
  protected readonly session = inject(WorkoutSessionStore);
  protected readonly warmingUp = signal<boolean>(true);
  protected readonly setNumber = signal<number>(2);
  protected readonly totalSets = SETS_PER_MOVEMENT;
  protected readonly movementIndex = signal<number>(0);
  protected readonly movement = computed(() => MORNING_STRENGTH_PLAN[this.movementIndex()]);
  protected readonly saveError = signal<'quota' | 'generic' | null>(null);
  private readonly completedReps = signal<number>(24);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly overlayRef = viewChild<ElementRef<HTMLCanvasElement>>('overlay');
  private mediaStream: MediaStream | null = null;
  private poseSession: PoseSession | null = null;
  private tracker: SquatRepTracker | null = null;
  private resumeCamera = false;
  private audioOnlyTimer: ReturnType<typeof setInterval> | null = null;
  private audioOnlyIndex = 0;

  constructor() {
    void this.mlWorker.warmUp().finally(() => this.warmingUp.set(false));
    // A fresh start from Today or the empty state resets the counters.
    let lastToken = this.session.startToken();
    effect(() => {
      const token = this.session.startToken();
      if (token !== lastToken) {
        lastToken = token;
        this.resetWorkout();
      }
    });
    // Start pose estimation once the <video> element exists for an active stream.
    effect(() => {
      const video = this.videoRef()?.nativeElement;
      if (video && this.mediaStream && !this.poseSession) {
        this.startPose(video, this.mediaStream);
      }
    });
  }

  private readonly timerId = setInterval(() => {
    if (this.phase() === 'active') {
      this.elapsedSeconds.update((s) => s + 1);
      this.telemetry.sample();
    }
  }, 1000);

  ngOnDestroy(): void {
    clearInterval(this.timerId);
    this.stopAudioOnlyCues();
    this.speaker.mute();
    this.voice.stop();
    this.stopMediaStream();
    void this.mlWorker.disposePose();
  }

  private startPose(video: HTMLVideoElement, stream: MediaStream): void {
    video.srcObject = stream;
    void Promise.resolve(video.play()).catch(() => undefined);
    const tracker = new SquatRepTracker(this.movement().targetReps, this.reps());
    this.tracker = tracker;
    this.poseStatus.set('Loading VitPose…');
    this.poseSession = new PoseSession({
      video,
      tracker,
      detect: (bitmap) => this.mlWorker.detectPose(bitmap, this.prefs.preferences().preferredBackend),
      onUpdate: (update) => this.onPoseUpdate(video, update),
    });
    this.poseSession.start();
  }

  private onPoseUpdate(video: HTMLVideoElement, update: PoseFrameUpdate): void {
    if (this.phase() !== 'active') {
      return;
    }
    if (!update.keypoints) {
      this.poseStatus.set('Pose model unavailable — use + Count rep');
      this.drawSkeleton(video, null, update);
      return;
    }
    const backend = update.device === 'webgpu' ? 'WebGPU' : 'WASM CPU';
    this.poseStatus.set(`VitPose ${backend} · ${Math.round(update.fps)} fps`);
    if (update.feedback && this.movement().tracked) {
      this.reps.set(update.feedback.reps);
      if (update.feedback.formScorePercent > 0) {
        this.formScore.set(update.feedback.formScorePercent);
      }
      this.activeCue.set(update.feedback.cue);
      if (update.feedback.repCompleted) {
        void this.speaker.speak(update.feedback.cue);
      }
    }
    this.drawSkeleton(video, update.keypoints, update);
  }

  private drawSkeleton(
    video: HTMLVideoElement,
    keypoints: PoseFrameUpdate['keypoints'],
    update: PoseFrameUpdate,
  ): void {
    const canvas = this.overlayRef()?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!keypoints) {
      return;
    }
    const style = getComputedStyle(canvas);
    const halo = style.getPropertyValue('--color-halo').trim() || '#f5b301';
    const map = (i: number) =>
      mapKeypointToDisplay(keypoints[i], update.crop, { width: video.videoWidth, height: video.videoHeight }, canvas);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = halo;
    for (const [a, b] of SKELETON_EDGES) {
      if (keypoints[a].score < 0.3 || keypoints[b].score < 0.3) continue;
      const pa = map(a);
      const pb = map(b);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.fillStyle = halo;
    keypoints.forEach((kp, i) => {
      if (kp.score < 0.3) return;
      const p = map(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  protected backendLabel(): string {
    return this.prefs.preferences().preferredBackend === 'WasmCpu' ? 'WASM CPU' : 'WebGPU';
  }

  protected totalSessionReps(): number {
    return this.completedReps() + this.reps();
  }

  protected heartRateLabel(): string {
    const bpm = this.heartRate();
    const zone = this.telemetry.zone();
    return bpm === null || zone === null ? 'No heart-rate sensor' : `${bpm} bpm · Zone ${zone}`;
  }

  protected heartRateCaption(): string {
    const source = this.telemetry.heartRateSource();
    return source ? `${source.label} · Live` : 'Pair a sensor in Devices';
  }

  private sensorsUsed(): string {
    const hr = this.telemetry.heartRateSource()?.label;
    return hr ? `${hr} & VitPose` : 'VitPose';
  }

  protected isLastSet(): boolean {
    return this.setNumber() >= this.totalSets && this.movementIndex() >= MORNING_STRENGTH_PLAN.length - 1;
  }

  protected upNext(): { name: string; detail: string } {
    const next = MORNING_STRENGTH_PLAN[this.movementIndex() + 1];
    return next ? { name: next.name, detail: next.prescription } : { name: 'Cool-down', detail: 'Finish and save your session' };
  }

  protected startWorkout(): void {
    this.session.start();
  }

  private resetWorkout(): void {
    this.movementIndex.set(0);
    this.setNumber.set(1);
    this.reps.set(0);
    this.completedReps.set(0);
    this.elapsedSeconds.set(0);
    this.formScore.set(95);
    this.phase.set('active');
    this.reflectionNote.set('');
    this.saveError.set(null);
    this.telemetry.resetSession();
    this.activeCue.set('Chest proud, smooth descent — great knee tracking.');
    this.restartTracker();
  }

  protected formattedElapsed(): string {
    const s = this.elapsedSeconds();
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  protected async requestCamera(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.phase.set('camera-blocked');
      return;
    }
    try {
      this.stopMediaStream();
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      this.cameraActive.set(true);
      this.phase.set('active');
    } catch {
      this.cameraActive.set(false);
      this.phase.set('camera-blocked');
    }
  }

  protected async logRep(): Promise<void> {
    const target = this.movement().targetReps;
    if (this.reps() >= target) return;
    const res = await this.mlWorker.stepPose(this.reps(), target, this.backendLabel());
    this.reps.set(res.completedReps);
    this.formScore.set(res.formScorePercent);
    this.activeCue.set(res.cue);
    void this.speaker.speak(res.cue);
  }

  /** Camera blocked: keep coaching with spoken cues only (L2-010). */
  protected continueAudioOnly(): void {
    this.phase.set('active');
    this.stopAudioOnlyCues();
    const speakNext = (): void => {
      if (this.phase() !== 'active') return;
      const cue = AUDIO_ONLY_CUES[this.audioOnlyIndex++ % AUDIO_ONLY_CUES.length];
      this.activeCue.set(cue);
      void this.speaker.speak(cue);
    };
    speakNext();
    this.audioOnlyTimer = setInterval(speakNext, 20000);
  }

  private stopAudioOnlyCues(): void {
    if (this.audioOnlyTimer !== null) {
      clearInterval(this.audioOnlyTimer);
      this.audioOnlyTimer = null;
    }
  }

  protected voiceButtonLabel(): string {
    switch (this.voice.state()) {
      case 'starting':
        return 'Starting microphone…';
      case 'blocked':
        return 'Microphone blocked — try again';
      case 'unsupported':
        return 'Voice commands unsupported';
      default:
        return 'Enable voice commands';
    }
  }

  /** Opens the microphone for Whisper voice commands; only ever called from a click. */
  protected async enableVoice(): Promise<void> {
    await this.voice.start((command) => this.onVoiceCommand(command));
  }

  private onVoiceCommand(command: VoiceCommand): void {
    switch (command) {
      case 'pause':
        if (this.phase() === 'active') this.pauseSession(true);
        break;
      case 'resume':
        if (this.phase() === 'paused') this.resume();
        break;
      case 'next-set':
        if (this.phase() === 'active') this.nextSet();
        break;
      case 'finish':
        if (!this.finishDialogOpen()) this.openFinishDialog();
        break;
    }
  }

  private restartTracker(): void {
    this.tracker?.retarget(this.movement().targetReps, 0);
  }

  /** Completes the current set and advances through every planned movement, finishing after the last (L2-010). */
  protected nextSet(): void {
    if (this.isLastSet()) {
      this.openFinishDialog();
      return;
    }
    this.completedReps.update((n) => n + this.reps());
    if (this.setNumber() < this.totalSets) {
      this.setNumber.update((n) => n + 1);
    } else {
      this.movementIndex.update((i) => i + 1);
      this.setNumber.set(1);
    }
    this.reps.set(0);
    const movement = this.movement();
    this.activeCue.set(`${movement.name} · set ${this.setNumber()} of ${this.totalSets} — smooth and controlled.`);
    this.restartTracker();
  }

  protected pause(): void {
    this.pauseSession(false);
  }

  /** A spoken pause keeps the microphone open so "Resume" can be heard; a manual pause releases it. */
  private pauseSession(keepMicrophone: boolean): void {
    if (!keepMicrophone) {
      this.voice.stop();
    }
    this.phase.set('paused');
    this.speaker.mute();
    // Release the camera while paused so the indicator turns off (L2-009).
    this.resumeCamera = this.cameraActive();
    this.stopMediaStream();
  }

  protected resume(): void {
    this.phase.set('active');
    if (this.resumeCamera) {
      this.resumeCamera = false;
      void this.requestCamera();
    }
  }

  protected openFinishDialog(): void {
    this.noteError.set(null);
    this.finishDialogOpen.set(true);
  }

  protected closeFinishDialog(): void {
    this.finishDialogOpen.set(false);
  }

  protected async saveSession(): Promise<void> {
    const err = validateReflectionNote(this.reflectionNote());
    this.noteError.set(err);
    if (err) {
      return;
    }
    this.saving.set(true);
    try {
      const id = `morning-strength-${Date.now()}`;
      await this.history.addSession({
        id,
        title: 'Morning Strength & Mobility',
        category: 'Strength',
        dateLabel: 'Mon 23 Nov',
        timeWindowLabel: 'Monday, 23 Nov 2026 · 07:15–07:27 EST',
        sensorsUsed: this.sensorsUsed(),
        durationMinutes: Math.max(1, Math.round(this.elapsedSeconds() / 60)),
        totalReps: this.totalSessionReps(),
        primaryMetricText: `${this.totalSessionReps()} reps${this.telemetry.heartRateSource() ? ' · ' + this.telemetry.heartRateSource()?.label : ''}`,
        avgHeartRateBpm: this.telemetry.averageBpm() ?? 0,
        formScorePercent: this.formScore(),
        recapText:
          'Smooth goblet squat depth and steady 3-1-1 tempo across working sets. Heart rate remained controlled in Zone 3.',
        devotionalNote: this.reflectionNote().trim() || 'Completed on-device strength session.',
        verseReference: 'Isaiah 40:31 · KJV',
      });
      this.voice.stop();
      this.saveError.set(null);
      this.session.end();
      this.stopMediaStream();
      this.finishDialogOpen.set(false);
      await this.router.navigate(['/history', id]);
    } catch (error) {
      // The dialog stays open with the note intact so the user can free space and retry (L2-026).
      const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
      this.saveError.set(quota ? 'quota' : 'generic');
    } finally {
      this.saving.set(false);
    }
  }

  private stopMediaStream(): void {
    if (this.poseSession) {
      this.poseSession.stop();
      this.poseSession = null;
    }
    this.poseStatus.set(null);
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    this.cameraActive.set(false);
  }
}
