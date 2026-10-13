import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Point } from "../engine/types";

const base = import.meta.env.BASE_URL;
const WASM = `${base}mediapipe`;
const MODEL = `${base}models/pose_landmarker_lite.task`;

export type PoseFrame = {
  points: Point[];
  poseCount: number;
  inferMs: number;
};

export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const options = {
    runningMode: "VIDEO" as const,
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  return PoseLandmarker.createFromOptions(vision, {
    ...options,
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
  }).catch(() =>
    PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
    }),
  );
}

export function detectPose(landmarker: PoseLandmarker, video: HTMLVideoElement, timestampMs: number): PoseFrame {
  const t0 = performance.now();
  const result = landmarker.detectForVideo(video, timestampMs);
  const inferMs = performance.now() - t0;
  const poses = result.landmarks ?? [];
  const first = poses[0] as NormalizedLandmark[] | undefined;
  const points: Point[] = (first ?? []).map((lm) => ({
    x: lm.x,
    y: lm.y,
    visibility: lm.visibility ?? 1,
  }));
  return { points, poseCount: poses.length, inferMs };
}
