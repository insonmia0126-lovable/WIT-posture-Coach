import { LM } from "./engine/metrics";
import type { Point } from "./engine/types";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
) {
  ctx.lineCap = "round";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = width + 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r + 1.25, 0, Math.PI * 2);
  ctx.fillStyle = "#111111";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement | null,
  points: Point[] | null,
  showLandmarks: boolean,
) {
  const w = video?.videoWidth || canvas.clientWidth || 960;
  const h = video?.videoHeight || canvas.clientHeight || 540;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const hasPose = Boolean(showLandmarks && points && points.length >= 13 && points[LM.LEFT_SHOULDER] && points[LM.RIGHT_SHOULDER]);

  if (hasPose && points) {
    const ls = points[LM.LEFT_SHOULDER];
    const rs = points[LM.RIGHT_SHOULDER];
    const le = points[LM.LEFT_EYE];
    const re = points[LM.RIGHT_EYE];
    const nose = points[LM.NOSE];
    const shoulderPx = Math.hypot((rs.x - ls.x) * w, (rs.y - ls.y) * h);
    const facePx = Math.hypot((re.x - le.x) * w, (re.y - le.y) * h);
    const lineW = clamp(shoulderPx * 0.02, 2, 6);
    const jointR = clamp(shoulderPx * 0.028, 3.5, 9);
    const faceRx = clamp(facePx * 1.35, 28, w * 0.22);
    const faceRy = clamp(facePx * 1.8, 36, h * 0.28);

    ctx.setLineDash([10, 7]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(nose.x * w, nose.y * h, faceRx, faceRy, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ls.x * w, ls.y * h);
    ctx.lineTo(rs.x * w, rs.y * h);
    ctx.stroke();
    ctx.setLineDash([]);

    strokeLine(ctx, le.x * w, le.y * h, re.x * w, re.y * h, "#FFE500", lineW);
    strokeLine(ctx, ls.x * w, ls.y * h, rs.x * w, rs.y * h, "#00F0A8", lineW);
    dot(ctx, le.x * w, le.y * h, jointR * 0.75, "#FFE500");
    dot(ctx, re.x * w, re.y * h, jointR * 0.75, "#FFE500");
    dot(ctx, nose.x * w, nose.y * h, jointR * 0.55, "#FFFFFF");
    dot(ctx, ls.x * w, ls.y * h, jointR, "#FF6A00");
    dot(ctx, rs.x * w, rs.y * h, jointR, "#FF6A00");
    return;
  }

  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.32, w * 0.16, h * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 0.22, h * 0.55);
  ctx.lineTo(w * 0.78, h * 0.55);
  ctx.stroke();
  ctx.setLineDash([]);
}
