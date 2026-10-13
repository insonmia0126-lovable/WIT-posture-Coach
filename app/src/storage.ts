import type { AppState } from "./engine/types";

export type StoredSession = {
  id: string;
  startedAt: string;
  demo: boolean;
  sessionMs: number;
  validMs: number;
  unavailableMs: number;
  inRangeMs: number;
  coachingCount: number;
  recoveryCount: number;
  meanRecoveryMs: number | null;
  timeline: { t: number; state: AppState }[];
};

const KEY = "wit.sessions.v2";

export function loadSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession[]) : [];
  } catch {
    return [];
  }
}

export function saveSession(row: StoredSession) {
  const all = loadSessions().filter((s) => s.id !== row.id);
  all.unshift(row);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 40)));
}

export function deleteSessions() {
  localStorage.removeItem(KEY);
}

export function toCsv(rows: StoredSession[]): string {
  const header = [
    "id",
    "startedAt",
    "mode",
    "session_s",
    "valid_s",
    "unavailable_s",
    "in_range_ratio",
    "coaching_count",
    "recovery_count",
    "mean_recovery_s",
  ];
  const lines = rows.map((r) => {
    const ratio = r.validMs > 0 ? ((r.inRangeMs / r.validMs) * 100).toFixed(1) : "";
    const rec = r.meanRecoveryMs == null ? "" : (r.meanRecoveryMs / 1000).toFixed(2);
    return [
      r.id,
      r.startedAt,
      r.demo ? "DEMO" : "WEBCAM",
      (r.sessionMs / 1000).toFixed(1),
      (r.validMs / 1000).toFixed(1),
      (r.unavailableMs / 1000).toFixed(1),
      ratio,
      String(r.coachingCount),
      String(r.recoveryCount),
      rec,
    ].join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
