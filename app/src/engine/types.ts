export type AppState =
  | "ready"
  | "calibrating"
  | "in_range"
  | "change_detected"
  | "coaching"
  | "unavailable"
  | "paused";

export type ChangeKind = "head" | "shoulder" | "torso";

export type Point = { x: number; y: number; visibility: number };

export type PoseSample = {
  t: number;
  points: Point[];
  poseCount: number;
};

export type Metrics = {
  headTiltDeg: number;
  shoulderTiltDeg: number;
  torsoDx: number;
  torsoDy: number;
  valid: boolean;
  reason: string;
};

export type Baseline = {
  headTiltDeg: number;
  shoulderTiltDeg: number;
  torsoDx: number;
  torsoDy: number;
};

export type CoachSettings = {
  calibrationMs: number;
  sustainMs: number;
  repeatAlertMs: number;
  recoveryMs: number;
  headEnterDeg: number;
  headExitDeg: number;
  shoulderEnterDeg: number;
  shoulderExitDeg: number;
  torsoEnter: number;
  torsoExit: number;
  minVisibility: number;
  inferEveryMs: number;
  demoShortDurations: boolean;
};

export const DEFAULT_SETTINGS: CoachSettings = {
  calibrationMs: 7000,
  sustainMs: 20000,
  repeatAlertMs: 180000,
  recoveryMs: 3000,
  headEnterDeg: 8,
  headExitDeg: 5,
  shoulderEnterDeg: 8,
  shoulderExitDeg: 5,
  torsoEnter: 0.12,
  torsoExit: 0.08,
  minVisibility: 0.55,
  inferEveryMs: 80,
  demoShortDurations: false,
};

export const DEMO_SHORT_SETTINGS: Partial<CoachSettings> = {
  calibrationMs: 5000,
  sustainMs: 2500,
  recoveryMs: 1200,
  repeatAlertMs: 4000,
  demoShortDurations: true,
};

export type CoachEvent = {
  t: number;
  state: AppState;
  kind?: ChangeKind;
  message: string;
};

export type CoachSnapshot = {
  t: number;
  state: AppState;
  metrics: Metrics | null;
  baseline: Baseline | null;
  deltas: { head: number; shoulder: number; torso: number } | null;
  coachingCount: number;
  recoveryCount: number;
  meanRecoveryMs: number | null;
  message: string;
  changeKind: ChangeKind | null;
  validMs: number;
  unavailableMs: number;
  inRangeMs: number;
  sessionMs: number;
  inferMs: number;
};
