import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./engine/types";
import { loadSettings, POSTURE_PRESETS, saveSettings, selectedPosturePreset } from "./settings";

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}

describe("local posture tolerance", () => {
  it("starts with relaxed tolerance without changing alert timing", () => {
    storage();
    const settings = loadSettings();
    expect(selectedPosturePreset(settings)).toBe("relaxed");
    expect(settings.sustainMs).toBe(20000);
    expect(settings.repeatAlertMs).toBe(180000);
  });

  it.each(POSTURE_PRESETS)("restores $id tolerance, keeping session timers at their defaults", (preset) => {
    storage();
    saveSettings({ ...DEFAULT_SETTINGS, ...preset.values, sustainMs: 1000 });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, ...preset.values });
  });

  it("discards invalid saved recovery bands", () => {
    storage();
    saveSettings({ ...DEFAULT_SETTINGS, torsoExit: 5 });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each(["front", "left", "right"] as const)("persists %s camera position", (cameraPosition) => {
    storage();
    saveSettings({ ...DEFAULT_SETTINGS, cameraPosition });
    expect(loadSettings().cameraPosition).toBe(cameraPosition);
  });

  it("loads older tolerance-only settings as frontal camera", () => {
    const values = storage();
    saveSettings(DEFAULT_SETTINGS);
    const saved = JSON.parse(values.values().next().value!);
    delete saved.cameraPosition;
    values.set("wit.posture-tolerance.local.v1", JSON.stringify(saved));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("continues when local storage is disabled", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); },
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("persists automatic return and smoothing independently of tolerance", () => {
    storage();
    saveSettings({ ...DEFAULT_SETTINGS, autoResumeOnReturn: false, smoothingMs: 250 });
    expect(loadSettings()).toMatchObject({ autoResumeOnReturn: false, smoothingMs: 250 });
    saveSettings({ ...DEFAULT_SETTINGS, smoothingMs: 0 });
    expect(loadSettings().smoothingMs).toBe(0);
  });
});
