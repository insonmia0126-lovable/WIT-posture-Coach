import type { AppState } from "./engine/types";

export type KindCounts = { head: number; shoulder: number; torso: number };

export type StoredSession = {
  id: string;
  personId?: string;
  personName?: string;
  startedAt: string;
  demo: boolean;
  sessionMs: number;
  validMs: number;
  unavailableMs: number;
  inRangeMs: number;
  coachingCount: number;
  recoveryCount: number;
  meanRecoveryMs: number | null;
  kindCounts: KindCounts;
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
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 300)));
}

export function sessionsForPerson(rows: StoredSession[], personId: string): StoredSession[] {
  return rows.filter((s) => s.personId === personId && !s.demo);
}

export function deleteSessions() {
  localStorage.removeItem(KEY);
}

export function deletePersonSessions(personId: string) {
  const kept = loadSessions().filter((s) => s.personId !== personId);
  localStorage.setItem(KEY, JSON.stringify(kept));
}

export function deleteSession(id: string) {
  const kept = loadSessions().filter((s) => s.id !== id);
  localStorage.setItem(KEY, JSON.stringify(kept));
}

export function toCsv(rows: StoredSession[]): string {
  const header = [
    "id",
    "person_id",
    "person_name",
    "startedAt",
    "mode",
    "session_s",
    "valid_s",
    "unavailable_s",
    "in_range_ratio",
    "coaching_count",
    "head_alerts",
    "shoulder_alerts",
    "torso_alerts",
    "recovery_count",
    "mean_recovery_s",
  ];
  const lines = rows.map((r) => {
    const ratio = r.validMs > 0 ? ((r.inRangeMs / r.validMs) * 100).toFixed(1) : "";
    const rec = r.meanRecoveryMs == null ? "" : (r.meanRecoveryMs / 1000).toFixed(2);
    const k = r.kindCounts ?? { head: 0, shoulder: 0, torso: 0 };
    return [
      r.id,
      r.personId ?? "",
      csvCell(r.personName ?? ""),
      r.startedAt,
      r.demo ? "DEMO" : "WEBCAM",
      (r.sessionMs / 1000).toFixed(1),
      (r.validMs / 1000).toFixed(1),
      (r.unavailableMs / 1000).toFixed(1),
      ratio,
      String(r.coachingCount),
      String(k.head),
      String(k.shoulder),
      String(k.torso),
      String(r.recoveryCount),
      rec,
    ].join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
