import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
import { PreferencesStore } from '../../core/state/preferences.store';
import { WorkoutHistoryStore } from '../../core/state/workout-history.store';
import { WorkoutPlanStore } from '../../core/state/workout-plan.store';
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
    <div class="cluster cluster--between">
      <div>
        <p class="overline">Morning Strength &amp; Mobility · Set 2 of 3</p>
        <p class="text-muted" style="margin-top:var(--space-1);">
          Goblet squats · VitPose {{ backendLabel() }} (30 fps) · Whisper voice commands listening
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
              {{ heartRate() }} bpm · Zone 3
            </span>
            <span class="camera-stage__pill">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              “Next set” ready
            </span>
            @if (poseStatus(); as status) {
              <span class="camera-stage__pill" role="status" data-testid="train-pose-status">{{ status }}</span>
            }
          </div>
        </div>
        <div class="camera-stage__center">
          <span class="overline" style="color:var(--color-sidebar-muted);">Goblet squats</span>
          <div class="camera-stage__reps" aria-live="polite" data-testid="train-reps">{{ reps() }} / 12</div>
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
          <span class="stat__value">{{ heartRate() }} bpm</span>
          <span class="stat__delta text-muted">Polar H10 · Live</span>
        </div>
        <div class="card stat">
          <span class="stat__label">Cadence</span>
          <span class="stat__value">3-1-1</span>
          <span class="stat__delta stat__delta--up">On target tempo</span>
        </div>
        <div class="card stat">
          <span class="stat__label">Up next</span>
          <span class="stat__value" style="font-size:var(--font-size-lg);">Incline push-ups</span>
          <span class="stat__delta text-muted">3 × 10 reps</span>
        </div>
      </section>
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
  private readonly history = inject(WorkoutHistoryStore);
  private readonly mlWorker = inject(MlWorkerClient);
  private readonly prefs = inject(PreferencesStore);
  private readonly router = inject(Router);

  protected readonly phase = signal<WorkoutPhase>('active');
  protected readonly reps = signal<number>(8);
  protected readonly formScore = signal<number>(95);
  protected readonly heartRate = signal<number>(134);
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

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly overlayRef = viewChild<ElementRef<HTMLCanvasElement>>('overlay');
  private mediaStream: MediaStream | null = null;
  private poseSession: PoseSession | null = null;
  private resumeCamera = false;
  private audioOnlyTimer: ReturnType<typeof setInterval> | null = null;
  private audioOnlyIndex = 0;

  constructor() {
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
    }
  }, 1000);

  ngOnDestroy(): void {
    clearInterval(this.timerId);
    this.stopAudioOnlyCues();
    this.speaker.mute();
    this.stopMediaStream();
    void this.mlWorker.disposePose();
  }

  private startPose(video: HTMLVideoElement, stream: MediaStream): void {
    video.srcObject = stream;
    void Promise.resolve(video.play()).catch(() => undefined);
    const tracker = new SquatRepTracker(12, this.reps());
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
    if (update.feedback) {
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
    return 24 + this.reps();
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
    if (this.reps() >= 12) return;
    const res = await this.mlWorker.stepPose(this.reps(), 12, this.backendLabel());
    this.reps.set(res.completedReps);
    this.formScore.set(res.formScorePercent);
    this.activeCue.set(res.cue);
    void this.speaker.speak(res.cue);
    this.heartRate.update((hr) => Math.min(165, hr + 1));
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

  protected pause(): void {
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
        sensorsUsed: 'Polar H10 & VitPose',
        durationMinutes: Math.max(1, Math.round(this.elapsedSeconds() / 60)),
        totalReps: this.totalSessionReps(),
        primaryMetricText: `${this.totalSessionReps()} reps · Polar H10`,
        avgHeartRateBpm: this.heartRate(),
        formScorePercent: this.formScore(),
        recapText:
          'Smooth goblet squat depth and steady 3-1-1 tempo across working sets. Heart rate remained controlled in Zone 3.',
        devotionalNote: this.reflectionNote().trim() || 'Completed on-device strength session.',
        verseReference: 'Isaiah 40:31 · KJV',
      });
      this.stopMediaStream();
      this.finishDialogOpen.set(false);
      await this.router.navigate(['/history', id]);
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
