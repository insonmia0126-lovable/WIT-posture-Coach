import { LM } from "./engine/metrics";
import type { Point } from "./engine/types";

export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement | null,
  points: Point[] | null,
  showLandmarks: boolean,
) {
  const w = video?.videoWidth || canvas.clientWidth || 960;
  const h = video?.videoHeight || canvas.clientHeight || 540;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  // Guide: face oval + shoulder band (in video space; CSS mirrors with the video)
  ctx.strokeStyle = "rgba(247,242,232,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.32, w * 0.16, h * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 0.22, h * 0.55);
  ctx.lineTo(w * 0.78, h * 0.55);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!showLandmarks || !points || points.length < 13) return;
  const xy = (i: number) => [points[i].x * w, points[i].y * h] as const;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#7dbe98";
  ctx.beginPath();
  ctx.moveTo(...xy(LM.LEFT_EYE));
  ctx.lineTo(...xy(LM.RIGHT_EYE));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(...xy(LM.LEFT_SHOULDER));
  ctx.lineTo(...xy(LM.RIGHT_SHOULDER));
  ctx.stroke();
  for (const i of [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER]) {
    ctx.fillStyle = i === LM.NOSE ? "#f4efe6" : "#c45c26";
    ctx.beginPath();
    ctx.arc(points[i].x * w, points[i].y * h, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}
