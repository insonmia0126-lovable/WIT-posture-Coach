import type { StoredSession } from "./storage";

/** 규칙 기반 개인 코치. 생성형 API를 호출하지 않는다. */
export function personalCoachLines(s: StoredSession): string[] {
  const lines: string[] = [];
  const ratio = s.validMs > 0 ? s.inRangeMs / s.validMs : 0;
  const unavailRatio = s.sessionMs > 0 ? s.unavailableMs / s.sessionMs : 0;
  const counts = s.kindCounts ?? { head: 0, shoulder: 0, torso: 0 };
  const head = counts.head;
  const shoulder = counts.shoulder;
  const torso = counts.torso;
  const dominant =
    s.coachingCount === 0
      ? null
      : head >= shoulder && head >= torso
        ? "head"
        : shoulder >= torso
          ? "shoulder"
          : "torso";

  if (s.demo) {
    lines.push("이번 결과는 시연용 시뮬레이션입니다. 실제 습관 점검에는 웹캠 세션 기록을 사용하세요.");
  }

  if (unavailRatio >= 0.25) {
    lines.push(
      "측정 불가 구간이 길었습니다. 노트북을 고정하고 얼굴과 양쪽 어깨가 화면에 들어오도록 앉은 뒤 기준을 다시 등록해 보세요.",
    );
  } else if (s.coachingCount === 0 && ratio >= 0.7) {
    lines.push(
      "이번 세션에서는 등록한 기준 범위를 비교적 잘 유지했습니다. 같은 자리에서 조금 더 긴 작업에도 이 자세를 떠올려 보세요.",
    );
  } else if (s.coachingCount === 0) {
    lines.push(
      "교정 안내는 없었지만 유효 측정이 짧거나 기준 유지 비율이 낮습니다. 다음엔 7초 기준 등록을 끝까지 마친 뒤 측정해 보세요.",
    );
  }

  if (dominant === "head") {
    lines.push(
      "고개 기울어짐 안내가 가장 많았습니다. 화면을 눈높이에 가깝게 두고, 턱을 살짝 들어 정면을 유지하는 습관을 짧게 반복해 보세요.",
    );
  } else if (dominant === "shoulder") {
    lines.push(
      "어깨 높이 차이가 자주 감지되었습니다. 키보드와 마우스를 몸 가까이에 두고, 한쪽 어깨만 올리거나 기대지 않는지 확인해 보세요.",
    );
  } else if (dominant === "torso") {
    lines.push(
      "상체가 기준보다 앞이나 옆으로 자주 이동했습니다. 엉덩이를 등받이에 붙이고 화면과 팔 길이가 닿을 거리를 유지해 보세요.",
    );
  }

  if (s.coachingCount > 0 && s.recoveryCount === 0) {
    lines.push(
      "안내 이후 기준 범위로 돌아온 기록이 없습니다. 알림이 뜨면 바로 정면을 보고 어깨를 내려 3초만 유지해 보세요.",
    );
  } else if (s.recoveryCount > 0 && s.meanRecoveryMs != null && s.meanRecoveryMs > 15000) {
    lines.push(
      `평균 복귀에 ${(s.meanRecoveryMs / 1000).toFixed(0)}초가 걸렸습니다. 알림을 미루지 말고, 짧게 자세를 고친 뒤 작업을 이어 가세요.`,
    );
  }

  if (s.coachingCount >= 3) {
    lines.push("안내가 잦았습니다. 20–30분마다 일어나 어깨를 한번 펴고, 필요하면 기준을 재등록하세요.");
  }

  if (lines.length < 3) {
    lines.push("목격자는 질환을 진단하지 않습니다. 불편함이 있으면 자세를 바꾸고 휴식을 우선하세요.");
  }
  if (lines.length < 3) {
    lines.push("카메라 위치나 앉는 자리를 바꿨다면 다음 세션 시작 전에 기준 자세를 다시 등록하세요.");
  }
  if (lines.length < 3) {
    lines.push("기록을 며칠 모아 보시면 어느 시간대에 자세가 자주 바뀌는지 스스로 점검할 수 있습니다.");
  }

  return lines.slice(0, 4);
}
