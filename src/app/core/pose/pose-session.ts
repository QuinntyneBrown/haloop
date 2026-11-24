import type { PoseFrameOutput } from '../ai/ml-worker.client';
import { Keypoint, PoseFeedback, SquatRepTracker } from './pose-math';

/** Model input size (portrait, 3:4). Frames are center-cropped to this aspect before being sent to the worker. */
export const POSE_FRAME_WIDTH = 192;
export const POSE_FRAME_HEIGHT = 256;

/** Source-video rectangle the worker saw, used to map keypoints back onto the preview overlay. */
export interface CropRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

export interface PoseFrameUpdate {
  readonly keypoints: readonly Keypoint[] | null;
  readonly crop: CropRect;
  readonly feedback: PoseFeedback | null;
  readonly device: PoseFrameOutput['device'];
  /** Smoothed processing rate in frames per second. */
  readonly fps: number;
  readonly unavailableReason?: string;
}

export interface PoseSessionOptions {
  readonly video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight' | 'readyState'>;
  readonly detect: (bitmap: ImageBitmap) => Promise<PoseFrameOutput>;
  readonly tracker: SquatRepTracker;
  readonly onUpdate: (update: PoseFrameUpdate) => void;
  /** Captures a cropped, downscaled frame. Defaults to `createImageBitmap` on the video element. */
  readonly capture?: (crop: CropRect) => Promise<ImageBitmap>;
  /** Schedules the next loop tick; defaults to a ~30 fps timer. */
  readonly schedule?: (tick: () => void) => () => void;
  readonly now?: () => number;
}

export function centerCrop(videoWidth: number, videoHeight: number): CropRect {
  const targetAspect = POSE_FRAME_WIDTH / POSE_FRAME_HEIGHT;
  let sw = videoWidth;
  let sh = Math.round(sw / targetAspect);
  if (sh > videoHeight) {
    sh = videoHeight;
    sw = Math.round(sh * targetAspect);
  }
  return { sx: Math.floor((videoWidth - sw) / 2), sy: Math.floor((videoHeight - sh) / 2), sw, sh };
}

/**
 * Maps a keypoint from worker-frame coordinates to overlay-canvas pixels for a `object-fit: cover` video.
 */
export function mapKeypointToDisplay(
  point: { readonly x: number; readonly y: number },
  crop: CropRect,
  video: { readonly width: number; readonly height: number },
  display: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const vx = crop.sx + (point.x * crop.sw) / POSE_FRAME_WIDTH;
  const vy = crop.sy + (point.y * crop.sh) / POSE_FRAME_HEIGHT;
  const scale = Math.max(display.width / video.width, display.height / video.height);
  return {
    x: vx * scale + (display.width - video.width * scale) / 2,
    y: vy * scale + (display.height - video.height * scale) / 2,
  };
}

/**
 * Drives live pose estimation: grab a frame, transfer it to the ML worker, update rep and form state.
 * Frames are dropped while one is in flight so the UI thread never queues work (L2-030). Frames never leave
 * the browser tab (L2-027).
 */
export class PoseSession {
  private running = false;
  private busy = false;
  private cancelTick: (() => void) | null = null;
  private fps = 0;
  private lastFrameAt = 0;

  constructor(private readonly options: PoseSessionOptions) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastFrameAt = 0;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }
    const schedule =
      this.options.schedule ??
      ((tick: () => void) => {
        const id = setTimeout(tick, 1000 / 30);
        return () => clearTimeout(id);
      });
    this.cancelTick = schedule(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }
    const { video } = this.options;
    if (!this.busy && video.readyState >= 2 && video.videoWidth > 0) {
      this.busy = true;
      try {
        await this.processFrame();
      } catch {
        // A failed capture is a dropped frame, not a crashed session.
      } finally {
        this.busy = false;
      }
    }
    this.scheduleNext();
  }

  private async processFrame(): Promise<void> {
    const { video, detect, tracker, onUpdate } = this.options;
    const now = this.options.now ?? (() => performance.now());
    const crop = centerCrop(video.videoWidth, video.videoHeight);
    const capture =
      this.options.capture ??
      ((c: CropRect) =>
        createImageBitmap(video as HTMLVideoElement, c.sx, c.sy, c.sw, c.sh, {
          resizeWidth: POSE_FRAME_WIDTH,
          resizeHeight: POSE_FRAME_HEIGHT,
          resizeQuality: 'medium',
        }));
    const bitmap = await capture(crop);
    const result = await detect(bitmap);
    if (!this.running) {
      return;
    }

    const t = now();
    if (this.lastFrameAt > 0) {
      const instant = 1000 / Math.max(1, t - this.lastFrameAt);
      this.fps = this.fps === 0 ? instant : this.fps * 0.8 + instant * 0.2;
    }
    this.lastFrameAt = t;

    if (!result.keypoints) {
      onUpdate({
        keypoints: null,
        crop,
        feedback: null,
        device: result.device,
        fps: this.fps,
        unavailableReason: result.reason,
      });
      return;
    }
    onUpdate({
      keypoints: result.keypoints,
      crop,
      feedback: tracker.update(result.keypoints),
      device: result.device,
      fps: this.fps,
    });
  }
}
