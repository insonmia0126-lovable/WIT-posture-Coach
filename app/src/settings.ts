import { DEFAULT_SETTINGS, type CoachSettings } from "./engine/types";
import { isCameraPosition } from "./engine/cameraPosition";

const TOLERANCE_KEYS = [
  "headEnterDeg", "headExitDeg", "shoulderEnterDeg", "shoulderExitDeg", "torsoEnter", "torsoExit",
] as const;
type Tolerance = Pick<CoachSettings, (typeof TOLERANCE_KEYS)[number]>;
const STORAGE_KEY = "wit.posture-tolerance.local.v1";

export const POSTURE_PRESETS: { id: string; label: string; values: Tolerance }[] = [
  {
    id: "original", label: "기존 (v0.2)",
    values: { headEnterDeg: 8, headExitDeg: 5, shoulderEnterDeg: 8, shoulderExitDeg: 5, torsoEnter: 0.12, torsoExit: 0.08 },
  },
  {
    id: "relaxed", label: "여유",
    values: { headEnterDeg: 12, headExitDeg: 9, shoulderEnterDeg: 12, shoulderExitDeg: 9, torsoEnter: 0.2, torsoExit: 0.15 },
  },
  {
    id: "desk", label: "업무 (기본)",
    values: { headEnterDeg: 14, headExitDeg: 9, shoulderEnterDeg: 14, shoulderExitDeg: 9, torsoEnter: 0.22, torsoExit: 0.14 },
  },
  {
    id: "spacious", label: "넉넉",
    values: { headEnterDeg: 16, headExitDeg: 12, shoulderEnterDeg: 16, shoulderExitDeg: 12, torsoEnter: 0.28, torsoExit: 0.21 },
  },
];

export function selectedPosturePreset(settings: CoachSettings): string {
  return POSTURE_PRESETS.find((preset) => TOLERANCE_KEYS.every((key) => settings[key] === preset.values[key]))?.id ?? "custom";
}

export function loadSettings(): CoachSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const defaults: CoachSettings = {
      ...DEFAULT_SETTINGS,
      cameraPosition: isCameraPosition(saved?.cameraPosition) ? saved.cameraPosition : DEFAULT_SETTINGS.cameraPosition,
      pauseWhenHidden: typeof saved?.pauseWhenHidden === "boolean" ? saved.pauseWhenHidden : DEFAULT_SETTINGS.pauseWhenHidden,
      autoResumeOnReturn: typeof saved?.autoResumeOnReturn === "boolean" ? saved.autoResumeOnReturn : DEFAULT_SETTINGS.autoResumeOnReturn,
      smoothingMs: [0, 120, 250].includes(saved?.smoothingMs) ? saved.smoothingMs : DEFAULT_SETTINGS.smoothingMs,
    };
    if (!saved || !TOLERANCE_KEYS.every((key) => typeof saved[key] === "number" && Number.isFinite(saved[key]) && saved[key] > 0)) {
      return defaults;
    }
    if (saved.headExitDeg >= saved.headEnterDeg || saved.shoulderExitDeg >= saved.shoulderEnterDeg || saved.torsoExit >= saved.torsoEnter) {
      return defaults;
    }
    const tolerance = Object.fromEntries(TOLERANCE_KEYS.map((key) => [key, saved[key]]));
    return { ...defaults, ...tolerance };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: CoachSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...Object.fromEntries(TOLERANCE_KEYS.map((key) => [key, settings[key]])),
      cameraPosition: settings.cameraPosition,
      pauseWhenHidden: settings.pauseWhenHidden,
      autoResumeOnReturn: settings.autoResumeOnReturn,
      smoothingMs: settings.smoothingMs,
    }));
  } catch {
    // Settings still work for this session when browser storage is unavailable.
  }
}
