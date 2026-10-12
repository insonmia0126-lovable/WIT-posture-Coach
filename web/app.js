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
const video = document.getElementById("cam");
const overlay = document.getElementById("overlay");
const monitor = document.getElementById("monitor");
const camStatus = document.getElementById("cam-status");
const camLive = document.getElementById("cam-live");
const sideSel = document.getElementById("side");

let t0 = performance.now();
let lastBell = 0;
let cameraOn = false;
let stream = null;
let poseLandmarker = null;
let poseLoading = false;
let lastVideoTime = -1;
let cameraAngle = 25;
let cameraOccluded = false;
let rafId = 0;
let spikeTimer = 0;
let tickInFlight = false;

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

function earShoulderAngle(ear, shoulder) {
  const vx = shoulder.x - ear.x;
  const vy = shoulder.y - ear.y;
  const norm = Math.hypot(vx, vy);
  if (norm < 1e-6) return 0;
  const cos = Math.min(1, Math.max(-1, vy / norm));
  return (Math.acos(cos) * 180) / Math.PI;
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
    ? "DEMO · 합성 입력으로 상태 판단 흐름을 시연합니다. 인식 정확도·사용자 개선 결과가 아닙니다."
    : "CAMERA · 웹캠 모니터에 모습이 표시됩니다. 정면 촬영은 대리지표이며 임상 CVA가 아닙니다.";

  if (show && state === "alert" && performance.now() - lastBell > 2000) {
    lastBell = performance.now();
  }
}

async function resetSession(demo = !cameraOn) {
  clearTimeout(spikeTimer);
  spikeTimer = 0;
  t0 = performance.now();
  if (demo) {
    angle.value = 25;
    angleReadout.textContent = "25°";
    occluded.checked = false;
  }
  const snap = await post("/api/reset", {
    demo,
    feedback_enabled: feedback.checked,
  });
  render(snap);
}

function setAngle(value) {
  clearTimeout(spikeTimer);
  spikeTimer = 0;
  angle.value = String(value);
  angleReadout.textContent = `${value}°`;
}

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const snap = await post("/api/step", {
      t: nowS(),
      angle_deg: cameraOn ? cameraAngle : Number(angle.value),
      occluded: cameraOn ? cameraOccluded : occluded.checked,
      demo: !cameraOn,
    });
    render(snap);
  } finally {
    tickInFlight = false;
  }
}

function setCamUi(on, message) {
  cameraOn = on;
  monitor.classList.toggle("live", on);
  camLive.className = on ? "live-dot on" : "live-dot off";
  camLive.textContent = on ? "LIVE" : "대기";
  camStatus.textContent = message;
}

function drawOverlay(landmarks) {
  const ctx = overlay.getContext("2d");
  const w = overlay.width;
  const h = overlay.height;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  const side = sideSel.value;
  const ear = side === "right" ? landmarks[8] : landmarks[7];
  const shoulder = side === "right" ? landmarks[12] : landmarks[11];
  if (!ear || !shoulder) return;
  ctx.strokeStyle = "#34d399";
  ctx.fillStyle = "#60a5fa";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ear.x * w, ear.y * h);
  ctx.lineTo(shoulder.x * w, shoulder.y * h);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ear.x * w, ear.y * h, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(shoulder.x * w, shoulder.y * h, 7, 0, Math.PI * 2);
  ctx.fill();
}

async function loadPose() {
  if (poseLandmarker || poseLoading) return poseLandmarker;
  poseLoading = true;
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
    const vision = await mod.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    poseLandmarker = await mod.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    camStatus.textContent = "웹캠 모니터 표시 중 · 귀–어깨 각도를 로컬에서 추정합니다.";
  } catch (err) {
    poseLandmarker = null;
    camStatus.textContent =
      "웹캠 모습은 표시됩니다. 각도 모델 로드에 실패해 미리보기만 동작합니다. " +
      (err && err.message ? err.message : "");
  } finally {
    poseLoading = false;
  }
  return poseLandmarker;
}

function poseLoop() {
  if (!cameraOn) return;
  overlay.width = video.videoWidth || overlay.clientWidth;
  overlay.height = video.videoHeight || overlay.clientHeight;
  if (poseLandmarker && video.currentTime !== lastVideoTime && video.videoWidth) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    const lm = result.landmarks && result.landmarks[0];
    if (lm) {
      const side = sideSel.value;
      const ear = side === "right" ? lm[8] : lm[7];
      const shoulder = side === "right" ? lm[12] : lm[11];
      const vis = Math.min(ear.visibility ?? 1, shoulder.visibility ?? 1);
      cameraOccluded = vis < 0.5;
      cameraAngle = earShoulderAngle(ear, shoulder);
      drawOverlay(cameraOccluded ? null : lm);
    } else {
      cameraOccluded = true;
      drawOverlay(null);
    }
  }
  rafId = requestAnimationFrame(poseLoop);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCamUi(false, "이 브라우저는 웹캠을 지원하지 않습니다.");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setCamUi(false, "카메라 권한이 거부되었거나 장치를 찾을 수 없습니다. 브라우저 설정에서 카메라를 허용하세요.");
    return;
  }
  video.srcObject = stream;
  await video.play();
  setCamUi(true, "웹캠 모니터에 모습이 표시됩니다. 영상은 저장하지 않습니다.");
  await resetSession(false);
  await loadPose();
  cancelAnimationFrame(rafId);
  poseLoop();
}

function stopCamera() {
  cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  cameraOccluded = false;
  cameraAngle = Number(angle.value);
  setCamUi(false, "웹캠을 껐습니다. DEMO 슬라이더로 돌아갑니다.");
  resetSession(true);
}

angle.addEventListener("input", () => {
  clearTimeout(spikeTimer);
  spikeTimer = 0;
  angleReadout.textContent = `${angle.value}°`;
});
feedback.addEventListener("change", () => resetSession(!cameraOn));
document.getElementById("reset").addEventListener("click", () => resetSession(!cameraOn));
document.getElementById("preset-base").addEventListener("click", () => setAngle(25));
document.getElementById("preset-hold").addEventListener("click", () => setAngle(50));
document.getElementById("preset-spike").addEventListener("click", () => {
  setAngle(50);
  spikeTimer = window.setTimeout(() => {
    angle.value = "25";
    angleReadout.textContent = "25°";
    spikeTimer = 0;
  }, 1000);
});
document.getElementById("save").addEventListener("click", async () => {
  const out = await post("/api/save", {});
  const mode = cameraOn ? "CAMERA" : "DEMO";
  saveStatus.textContent = `저장: ${out.path} (${out.rows}행). mode=${mode}, feedback_enabled 열을 확인하세요.`;
});
document.getElementById("start-cam").addEventListener("click", startCamera);
document.getElementById("stop-cam").addEventListener("click", stopCamera);

resetSession(true).then(() => {
  setInterval(tick, 100);
});
