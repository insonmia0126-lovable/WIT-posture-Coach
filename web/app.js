const STATE_KO = {
  idle: "대기",
  calibrating: "기준 기록",
  stable: "안정",
  watch: "경계",
  sustained: "변화 지속",
  alert: "알림",
  recovering: "회복 확인",
  interrupted: "측정 불가",
};

const metricsEl = document.getElementById("metrics");
const stateCard = document.getElementById("state-card");
const stateName = document.getElementById("state-name");
const reason = document.getElementById("reason");
const angle = document.getElementById("angle");
const angleReadout = document.getElementById("angle-readout");
const occluded = document.getElementById("occluded");
const feedback = document.getElementById("feedback");
const banner = document.getElementById("banner");
const hiddenA = document.getElementById("hidden-a");
const saveStatus = document.getElementById("save-status");

let t0 = performance.now();
let lastBell = 0;

function nowS() {
  return (performance.now() - t0) / 1000;
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function metric(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function fmt(n, suffix = "°") {
  if (n === null || n === undefined) return "—";
  return `${Number(n).toFixed(1)}${suffix}`;
}

function render(snap) {
  const show = snap.feedback_enabled;
  hiddenA.hidden = show;
  const state = snap.state;
  stateCard.className = `state ${state}`;
  if (show) {
    stateName.textContent = STATE_KO[state] || state;
    reason.textContent = snap.reason || "";
  } else {
    stateName.textContent = "기록 중 (A)";
    reason.textContent = "피드백이 숨겨져 있습니다.";
  }
  const mean = show
    ? snap.mean_recovery_s == null
      ? "—"
      : `${snap.mean_recovery_s.toFixed(1)}s`
    : "숨김";
  metricsEl.innerHTML = [
    metric("현재 각도", fmt(snap.angle_deg)),
    metric("개인 기준", snap.baseline_deg == null ? "기록 중" : fmt(snap.baseline_deg)),
    metric("기준 대비", snap.delta_deg == null ? "—" : `${snap.delta_deg >= 0 ? "+" : ""}${snap.delta_deg.toFixed(1)}°`),
    metric("알림 횟수", show ? String(snap.alert_count) : "숨김"),
    metric("회복 확인", show ? String(snap.recovery_count) : "숨김"),
    metric("평균 회복", mean),
  ].join("");

  banner.className = snap.demo ? "banner demo" : "banner camera";
  banner.textContent = snap.demo
    ? "DEMO · 합성 입력으로 상태 판단 흐름을 시연합니다. 카메라 인식 정확도나 사용자 개선 결과가 아닙니다."
    : "CAMERA · 측면 카메라 로컬 추론. 정면·임상 CVA가 아닙니다.";

  if (show && state === "alert" && performance.now() - lastBell > 2000) {
    lastBell = performance.now();
  }
}

async function resetSession() {
  t0 = performance.now();
  angle.value = 25;
  angleReadout.textContent = "25°";
  occluded.checked = false;
  const snap = await post("/api/reset", {
    demo: true,
    feedback_enabled: feedback.checked,
  });
  render(snap);
}

async function tick() {
  const snap = await post("/api/step", {
    t: nowS(),
    angle_deg: Number(angle.value),
    occluded: occluded.checked,
    demo: true,
  });
  render(snap);
}

angle.addEventListener("input", () => {
  angleReadout.textContent = `${angle.value}°`;
});
feedback.addEventListener("change", resetSession);
document.getElementById("reset").addEventListener("click", resetSession);
document.getElementById("preset-base").addEventListener("click", () => {
  angle.value = 25;
  angleReadout.textContent = "25°";
});
document.getElementById("preset-hold").addEventListener("click", () => {
  angle.value = 50;
  angleReadout.textContent = "50°";
});
document.getElementById("preset-spike").addEventListener("click", async () => {
  angle.value = 50;
  angleReadout.textContent = "50°";
  setTimeout(() => {
    angle.value = 25;
    angleReadout.textContent = "25°";
  }, 1000);
});
document.getElementById("save").addEventListener("click", async () => {
  const out = await post("/api/save", {});
  saveStatus.textContent = `저장: ${out.path} (${out.rows}행). mode=DEMO, feedback_enabled 열을 확인하세요.`;
});

resetSession().then(() => {
  setInterval(tick, 100);
});
