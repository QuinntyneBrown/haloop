/**
 * Pure pose maths for live rep counting and form scoring from COCO-17 keypoints (L2-009).
 * No browser APIs: this runs on the main thread from keypoints returned by the ML worker.
 */

export interface Keypoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/** COCO-17 keypoint indices produced by `onnx-community/vitpose-base-simple`. */
export const COCO = {
  nose: 0,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
} as const;

/** Pairs of keypoint indices drawn as the skeleton overlay. */
export const SKELETON_EDGES: readonly (readonly [number, number])[] = [
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

export const MIN_KEYPOINT_SCORE = 0.3;

/** Interior angle at `b` (degrees, 0–180) formed by the segments b→a and b→c. */
export function jointAngle(a: Keypoint, b: Keypoint, c: Keypoint): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (mag === 0) {
    return 180;
  }
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

function visible(kp: Keypoint | undefined): kp is Keypoint {
  return kp !== undefined && kp.score >= MIN_KEYPOINT_SCORE;
}

/** Mean knee angle over the sides whose hip, knee and ankle are confidently detected, else `null`. */
export function kneeAngle(kps: readonly Keypoint[]): number | null {
  const sides = [
    [COCO.leftHip, COCO.leftKnee, COCO.leftAnkle],
    [COCO.rightHip, COCO.rightKnee, COCO.rightAnkle],
  ] as const;
  const angles: number[] = [];
  for (const [h, k, a] of sides) {
    const hip = kps[h];
    const knee = kps[k];
    const ankle = kps[a];
    if (visible(hip) && visible(knee) && visible(ankle)) {
      angles.push(jointAngle(hip, knee, ankle));
    }
  }
  return angles.length === 0 ? null : angles.reduce((s, v) => s + v, 0) / angles.length;
}

/** Torso lean from vertical in degrees (0 = upright), from the shoulder midpoint to the hip midpoint. */
export function torsoLean(kps: readonly Keypoint[]): number | null {
  const ls = kps[COCO.leftShoulder];
  const rs = kps[COCO.rightShoulder];
  const lh = kps[COCO.leftHip];
  const rh = kps[COCO.rightHip];
  if (!visible(ls) || !visible(rs) || !visible(lh) || !visible(rh)) {
    return null;
  }
  const dx = (ls.x + rs.x) / 2 - (lh.x + rh.x) / 2;
  const dy = (lh.y + rh.y) / 2 - (ls.y + rs.y) / 2;
  return (Math.atan2(Math.abs(dx), Math.max(1e-6, dy)) * 180) / Math.PI;
}

export const STANDING_KNEE_ANGLE = 160;
export const BOTTOM_KNEE_ANGLE = 105;
const TARGET_DEPTH_ANGLE = 90;

export interface PoseFeedback {
  readonly reps: number;
  readonly formScorePercent: number;
  readonly cue: string;
  readonly phase: 'up' | 'down';
  /** True when a rep finished on this frame. */
  readonly repCompleted: boolean;
}

/**
 * Squat rep state machine with hysteresis. A rep is counted when the knee angle drops below
 * {@link BOTTOM_KNEE_ANGLE} and returns above {@link STANDING_KNEE_ANGLE}; form combines depth and torso lean.
 */
export class SquatRepTracker {
  private reps = 0;
  private phase: 'up' | 'down' = 'up';
  private minKnee = 180;
  private maxLean = 0;
  private formTotal = 0;
  private scored = 0;
  private cue = 'Stand tall in frame, feet shoulder-width apart.';

  constructor(
    private readonly targetReps: number,
    startingReps = 0,
  ) {
    this.reps = startingReps;
  }

  get currentReps(): number {
    return this.reps;
  }

  /** Feeds one frame of keypoints; frames without a confident lower body leave the state unchanged. */
  update(kps: readonly Keypoint[]): PoseFeedback {
    const knee = kneeAngle(kps);
    if (knee === null) {
      return this.snapshot(false);
    }
    const lean = torsoLean(kps) ?? 0;
    let repCompleted = false;

    if (this.phase === 'up' && knee < BOTTOM_KNEE_ANGLE) {
      this.phase = 'down';
      this.minKnee = knee;
      this.maxLean = lean;
      this.cue = 'Good depth — drive up through mid-foot.';
    } else if (this.phase === 'down') {
      this.minKnee = Math.min(this.minKnee, knee);
      this.maxLean = Math.max(this.maxLean, lean);
      if (knee > STANDING_KNEE_ANGLE && this.reps < this.targetReps) {
        this.reps += 1;
        this.phase = 'up';
        repCompleted = true;
        const score = this.scoreRep();
        this.formTotal += score;
        this.scored += 1;
        this.cue = this.cueFor(score);
      } else if (knee > STANDING_KNEE_ANGLE) {
        this.phase = 'up';
      }
    } else if (knee < STANDING_KNEE_ANGLE - 10) {
      this.cue = 'Keep sinking — chest proud, knees tracking over toes.';
    }
    return this.snapshot(repCompleted);
  }

  reset(startingReps = 0): void {
    this.reps = startingReps;
    this.phase = 'up';
    this.formTotal = 0;
    this.scored = 0;
    this.cue = 'Stand tall in frame, feet shoulder-width apart.';
  }

  private scoreRep(): number {
    const depth = Math.min(1, Math.max(0, (STANDING_KNEE_ANGLE - this.minKnee) / (STANDING_KNEE_ANGLE - TARGET_DEPTH_ANGLE)));
    const upright = Math.min(1, Math.max(0, 1 - this.maxLean / 45));
    return Math.round(100 * (0.6 * depth + 0.4 * upright));
  }

  private cueFor(score: number): string {
    const depth = (STANDING_KNEE_ANGLE - this.minKnee) / (STANDING_KNEE_ANGLE - TARGET_DEPTH_ANGLE);
    if (this.maxLean > 30) {
      return 'Lift your chest — keep your torso more upright.';
    }
    if (depth < 0.7) {
      return 'Sink a little deeper on the next rep.';
    }
    return score >= 90 ? 'Chest proud, smooth descent — great knee tracking.' : 'Steady tempo — brace your core at the bottom.';
  }

  private snapshot(repCompleted: boolean): PoseFeedback {
    return {
      reps: this.reps,
      formScorePercent: this.scored > 0 ? Math.round(this.formTotal / this.scored) : 0,
      cue: this.cue,
      phase: this.phase,
      repCompleted,
    };
  }
}
