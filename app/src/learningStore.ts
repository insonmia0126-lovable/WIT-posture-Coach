import { personalCoachLines } from "./coachGuide";
import type { StoredSession } from "./storage";
import { APP_VERSION } from "./version";

export type LearningEntry = {
  id: string;
  savedAt: string;
  appVersion: string;
  session: StoredSession;
  coachLines: string[];
  memo: string;
};

const KEY = "wit.learning.v1";

export function loadLearning(): LearningEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LearningEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveLearning(entry: LearningEntry) {
  const all = loadLearning().filter((e) => e.id !== entry.id);
  all.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 200)));
}

export function updateLearningMemo(id: string, memo: string) {
  const all = loadLearning().map((e) => (e.id === id ? { ...e, memo } : e));
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteLearning() {
  localStorage.removeItem(KEY);
}

export function entryFromSession(session: StoredSession, memo = ""): LearningEntry {
  return {
    id: session.id,
    savedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    session,
    coachLines: personalCoachLines(session),
    memo,
  };
}

export function learningToMarkdown(entries: LearningEntry[]): string {
  const blocks = entries.map((e) => {
    const s = e.session;
    const k = s.kindCounts ?? { head: 0, shoulder: 0, torso: 0 };
    const ratio = s.validMs > 0 ? ((s.inRangeMs / s.validMs) * 100).toFixed(1) : "—";
    return [
      `## ${e.savedAt} · v${e.appVersion} · ${s.demo ? "시연" : "웹캠"}`,
      "",
      `- 세션 ${ (s.sessionMs / 1000).toFixed(1) }초 / 유효 ${ (s.validMs / 1000).toFixed(1) }초 / 불가 ${ (s.unavailableMs / 1000).toFixed(1) }초`,
      `- 기준 유지 ${ratio}% / 안내 ${s.coachingCount} (고개 ${k.head}, 어깨 ${k.shoulder}, 상체 ${k.torso}) / 복귀 ${s.recoveryCount}`,
      "",
      "### 개인 코치",
      ...e.coachLines.map((l) => `- ${l}`),
      "",
      "### 메모",
      e.memo.trim() || "(없음)",
      "",
    ].join("\n");
  });
  return `# 목격자 학습 기록\n\n브라우저에서보낸 내보내기입니다. 팀 공유 시 learning/entries/ 에 붙여 넣습니다.\n\n${blocks.join("\n---\n\n")}`;
}
