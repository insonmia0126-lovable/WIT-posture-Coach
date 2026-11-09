export type AppState =
  | "ready"
  | "calibrating"
  | "in_range"
  | "change_detected"
  | "coaching"
  | "unavailable"
  | "paused";

export type ChangeKind = "head" | "shoulder" | "torso";
export type CameraPosition = "front" | "left" | "right";
export type PauseReason = "manual" | "hidden";

export type Point = { x: number; y: number; visibility: number };

export type PoseSample = {
  t: number;
  points: Point[];
  poseCount: number;
};

export type Metrics = {
  cameraPosition: CameraPosition;
  torsoScale: number;
  headTiltDeg: number;
  shoulderTiltDeg: number;
  torsoDx: number;
  torsoDy: number;
  valid: boolean;
  reason: string;
};

export type Baseline = {
  cameraPosition: CameraPosition;
  torsoScale: number;
  headTiltDeg: number;
  shoulderTiltDeg: number;
  torsoDx: number;
  torsoDy: number;
};

export type CoachSettings = {
  cameraPosition: CameraPosition;
  calibrationMs: number;
  autoResumeOnReturn: boolean;
  smoothingMs: number;
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
  cameraPosition: "front",
  calibrationMs: 7000,
  autoResumeOnReturn: true,
  smoothingMs: 120,
  sustainMs: 20000,
  repeatAlertMs: 180000,
  recoveryMs: 3000,
  headEnterDeg: 12,
  headExitDeg: 9,
  shoulderEnterDeg: 12,
  shoulderExitDeg: 9,
  torsoEnter: 0.2,
  torsoExit: 0.15,
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
  pausedMs: number;
  pauseReason: PauseReason | null;
  calibrationStableMs: number;
  calibrationTargetMs: number;
  inferMs: number;
};
