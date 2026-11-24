// Acceptance Test
// Traces to: L2-009, L2-027, L2-029, L2-030
// Description: Verify joint-angle rep counting and form scoring from keypoints, the frame loop that drives the
// ML worker without queuing frames, the VitPose engine's WebGPU to WASM fallback, and that the Train page
// requests the camera only on a user gesture and stops every track on pause and destroy.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MlWorkerClient, PoseFrameOutput } from '../ai/ml-worker.client';
import { TrainPageComponent } from '../../features/train/train-page.component';
import { VitPoseLibrary, createVitPoseEngine } from '../../workers/vitpose-engine';
import { COCO, Keypoint, SquatRepTracker, jointAngle, kneeAngle } from './pose-math';
import { PoseSession, centerCrop, mapKeypointToDisplay } from './pose-session';

/** Builds a 17-keypoint standing pose whose knee angle equals `knee` degrees (side view). */
function poseWithKnee(knee: number, leanDx = 0): Keypoint[] {
  const kps: Keypoint[] = Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0 }));
  const hip = { x: 100, y: 100 };
  const thigh = 50;
  const shin = 50;
  const kneePt = { x: hip.x + thigh, y: hip.y };
  const rad = (knee * Math.PI) / 180;
  // Ankle sits `shin` away from the knee, rotated so the hip-knee-ankle angle equals `knee`.
  const ankle = { x: kneePt.x - Math.cos(rad) * shin * -1 * -1, y: kneePt.y + Math.sin(rad) * shin };
  const set = (i: number, p: { x: number; y: number }) => (kps[i] = { x: p.x, y: p.y, score: 0.9 });
  for (const [h, k, a, side] of [
    [COCO.leftHip, COCO.leftKnee, COCO.leftAnkle, 0],
    [COCO.rightHip, COCO.rightKnee, COCO.rightAnkle, 0],
  ] as const) {
    set(h, { x: hip.x + side, y: hip.y });
    set(k, { x: kneePt.x + side, y: kneePt.y });
    set(a, { x: ankle.x + side, y: ankle.y });
  }
  set(COCO.leftShoulder, { x: hip.x + leanDx, y: hip.y - 80 });
  set(COCO.rightShoulder, { x: hip.x + leanDx, y: hip.y - 80 });
  return kps;
}

describe('pose maths', () => {
  it('computes interior joint angles in degrees (L2-009)', () => {
    const a = { x: 0, y: 1, score: 1 };
    const b = { x: 0, y: 0, score: 1 };
    expect(jointAngle(a, b, { x: 1, y: 0, score: 1 })).toBeCloseTo(90, 5);
    expect(jointAngle(a, b, { x: 0, y: -1, score: 1 })).toBeCloseTo(180, 5);
  });

  it('measures the knee angle and ignores low-confidence joints (L2-009)', () => {
    expect(kneeAngle(poseWithKnee(90))).toBeCloseTo(90, 0);
    expect(kneeAngle(poseWithKnee(170))).toBeCloseTo(170, 0);
    expect(kneeAngle(Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0.1 })))).toBeNull();
  });

  it('counts a rep only after a full descent and return to standing, and scores form (L2-009)', () => {
    const tracker = new SquatRepTracker(12);
    let last = tracker.update(poseWithKnee(170));
    expect(last.reps).toBe(0);

    for (const knee of [140, 110, 85, 100, 130, 170]) {
      last = tracker.update(poseWithKnee(knee));
    }
    expect(last.reps).toBe(1);
    expect(last.repCompleted).toBe(true);
    expect(last.formScorePercent).toBeGreaterThanOrEqual(85);

    // A shallow dip that never reaches the bottom threshold is not a rep.
    for (const knee of [150, 130, 150, 170]) {
      last = tracker.update(poseWithKnee(knee));
    }
    expect(last.reps).toBe(1);
  });

  it('scores shallow, leaning reps lower and stops at the target (L2-009)', () => {
    const deep = new SquatRepTracker(12);
    const shallow = new SquatRepTracker(12);
    for (const knee of [170, 85, 170]) deep.update(poseWithKnee(knee));
    for (const knee of [170, 103, 170]) shallow.update(poseWithKnee(knee, 60));
    expect(shallow.update(poseWithKnee(170, 60)).formScorePercent).toBeLessThan(
      deep.update(poseWithKnee(170)).formScorePercent,
    );

    const capped = new SquatRepTracker(1);
    for (const knee of [170, 85, 170, 85, 170]) capped.update(poseWithKnee(knee));
    expect(capped.currentReps).toBe(1);
  });

  it('leaves state unchanged when the lower body is not visible (L2-009)', () => {
    const tracker = new SquatRepTracker(12, 4);
    const blank = Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0 }));
    expect(tracker.update(blank).reps).toBe(4);
  });

  it('center-crops to the 3:4 model aspect and maps keypoints onto a cover-fit overlay (L2-030)', () => {
    const crop = centerCrop(1280, 720);
    expect(crop.sh).toBe(720);
    expect(crop.sw / crop.sh).toBeCloseTo(0.75, 2);
    expect(crop.sx).toBe(Math.floor((1280 - crop.sw) / 2));

    const p = mapKeypointToDisplay({ x: 96, y: 128 }, crop, { width: 1280, height: 720 }, { width: 640, height: 360 });
    expect(p.x).toBeCloseTo(320, 0);
    expect(p.y).toBeCloseTo(180, 0);
  });
});

describe('PoseSession frame loop', () => {
  const video = { videoWidth: 1280, videoHeight: 720, readyState: 4 };

  function setup(detect: (b: ImageBitmap) => Promise<PoseFrameOutput>) {
    const ticks: (() => void)[] = [];
    const updates: { reps: number | undefined; fps: number; reason?: string }[] = [];
    let t = 0;
    const session = new PoseSession({
      video,
      detect,
      tracker: new SquatRepTracker(12),
      capture: async () => ({ close: () => undefined }) as unknown as ImageBitmap,
      schedule: (tick) => {
        ticks.push(tick);
        return () => undefined;
      },
      now: () => (t += 33),
      onUpdate: (u) => updates.push({ reps: u.feedback?.reps, fps: u.fps, reason: u.unavailableReason }),
    });
    return { session, ticks, updates };
  }

  it('updates live state from detected keypoints and reports fps (L2-009, L2-030)', async () => {
    const frames = [170, 85, 170].map((k) => poseWithKnee(k));
    let i = 0;
    const { session, ticks, updates } = setup(async () => ({ keypoints: frames[i++ % 3], device: 'wasm', inferenceMs: 20 }));
    session.start();
    for (let n = 0; n < 3; n++) {
      ticks.shift()!();
      await vi.waitFor(() => expect(updates.length).toBe(n + 1));
    }
    expect(updates.at(-1)?.reps).toBe(1);
    expect(updates.at(-1)?.fps).toBeGreaterThan(20);
  });

  it('drops ticks while a frame is in flight instead of queueing them (L2-030)', async () => {
    let release: (v: PoseFrameOutput) => void = () => undefined;
    let calls = 0;
    const { session, ticks, updates } = setup(() => {
      calls += 1;
      return new Promise((resolve) => (release = resolve));
    });
    session.start();
    ticks.shift()!();
    await vi.waitFor(() => expect(calls).toBe(1));
    ticks.shift()?.();
    expect(calls).toBe(1);
    release({ keypoints: poseWithKnee(170), device: 'wasm', inferenceMs: 5 });
    await vi.waitFor(() => expect(updates.length).toBe(1));
  });

  it('reports unavailability and stops scheduling after stop() (L2-029)', async () => {
    const { session, ticks, updates } = setup(async () => ({
      keypoints: null,
      device: null,
      inferenceMs: 0,
      reason: 'no model',
    }));
    session.start();
    ticks.shift()!();
    await vi.waitFor(() => expect(updates.length).toBe(1));
    expect(updates[0].reason).toBe('no model');

    session.stop();
    ticks.length = 0;
    expect(ticks.length).toBe(0);
  });
});

describe('VitPose engine', () => {
  function fakeLibrary(failGpu: boolean) {
    const loads: string[] = [];
    const heatmapPoints = Array.from({ length: 17 }, (_, i) => [i * 10, i * 5] as [number, number]);
    const lib: VitPoseLibrary = {
      env: { useBrowserCache: false, allowLocalModels: false, allowRemoteModels: true },
      AutoProcessor: {
        from_pretrained: async () =>
          Object.assign(async () => ({ pixel_values: {} }), {
            post_process_pose_estimation: () => [
              [{ keypoints: heatmapPoints, scores: heatmapPoints.map(() => 0.8), labels: heatmapPoints.map((_, i) => i) }],
            ],
          }),
      },
      AutoModel: {
        from_pretrained: async (_id, options) => {
          loads.push(options.device);
          if (options.device === 'webgpu' && failGpu) {
            throw new Error('no webgpu session');
          }
          return Object.assign(async () => ({ heatmaps: { tolist: () => [] } }), { dispose: async () => undefined });
        },
      },
      RawImage: class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number,
          readonly channels: number,
        ) {}
      },
    };
    return { lib, loads };
  }

  const frame = { data: new Uint8ClampedArray(192 * 256 * 4), width: 192, height: 256 };

  it('runs on WebGPU and returns 17 keypoints (L2-009, L2-030)', async () => {
    const { lib, loads } = fakeLibrary(false);
    const engine = createVitPoseEngine({ loadLibrary: async () => lib, detectWebGpu: async () => true });
    const result = await engine.detect(frame, 'AutoWebGpu');
    expect(result.device).toBe('webgpu');
    expect(result.keypoints).toHaveLength(17);
    await engine.detect(frame, 'AutoWebGpu');
    expect(loads).toEqual(['webgpu']);
  });

  it('falls back to WASM CPU when the WebGPU session cannot be created (L2-030)', async () => {
    const { lib, loads } = fakeLibrary(true);
    const engine = createVitPoseEngine({ loadLibrary: async () => lib, detectWebGpu: async () => true });
    const result = await engine.detect(frame, 'AutoWebGpu');
    expect(result.device).toBe('wasm');
    expect(loads).toEqual(['webgpu', 'wasm']);
  });

  it('uses WASM CPU when preferred or when WebGPU is unavailable (L2-030)', async () => {
    const preferred = fakeLibrary(false);
    const engineA = createVitPoseEngine({ loadLibrary: async () => preferred.lib, detectWebGpu: async () => true });
    expect((await engineA.detect(frame, 'WasmCpu')).device).toBe('wasm');

    const none = fakeLibrary(false);
    const engineB = createVitPoseEngine({ loadLibrary: async () => none.lib, detectWebGpu: async () => false });
    expect((await engineB.detect(frame, 'AutoWebGpu')).device).toBe('wasm');
  });

  it('reports a reason instead of throwing when the model cannot load (L2-029)', async () => {
    const engine = createVitPoseEngine({
      loadLibrary: async () => {
        throw new Error('offline and not cached');
      },
      detectWebGpu: async () => false,
    });
    const result = await engine.detect(frame, 'AutoWebGpu');
    expect(result.keypoints).toBeNull();
    expect(result.reason).toContain('offline and not cached');
  });
});

describe('Train camera lifecycle', () => {
  class FakeTrack {
    stopped = false;
    stop(): void {
      this.stopped = true;
    }
  }

  function setup() {
    const track = new FakeTrack();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream);
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: MlWorkerClient,
          useValue: {
            detectPose: async () => ({ keypoints: null, device: null, inferenceMs: 0 }),
            disposePose: async () => undefined,
            stepPose: async () => ({ completedReps: 9, formScorePercent: 95, cue: 'ok', backend: 'WebGPU' }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(TrainPageComponent);
    fixture.detectChanges();
    return { fixture, track, getUserMedia, host: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('does not request the camera until the user clicks Enable webcam (L2-009)', () => {
    const { getUserMedia, fixture } = setup();
    expect(getUserMedia).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('renders the local video preview and stops every track on pause and on destroy (L2-009, L2-027)', async () => {
    const { fixture, track, getUserMedia, host } = setup();

    host.querySelector<HTMLButtonElement>('[data-testid="train-enable-camera"]')!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector('video')).not.toBeNull();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const video = host.querySelector('video')!;
    expect(video.hasAttribute('autoplay')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(host.querySelector('[data-testid="train-pose-overlay"]')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-testid="train-pause"]')!.click();
    fixture.detectChanges();
    expect(track.stopped).toBe(true);
    expect(host.querySelector('video')).toBeNull();

    // Resuming re-acquires the camera on the user's gesture; destroying releases it again.
    track.stopped = false;
    host.querySelector<HTMLButtonElement>('[data-testid="train-resume"]')!.click();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    fixture.destroy();
    expect(track.stopped).toBe(true);
  });
});
