import { lineAngleDifference, median } from "./metrics";
import type { Metrics } from "./types";

/** Three-sample median rejects single-frame spikes; time-based EMA follows sustained movement. */
export class MetricSmoother {
  private samples: Metrics[] = [];
  private previous: Metrics | null = null;
  private lastT: number | null = null;

  reset() {
    this.samples = [];
    this.previous = null;
    this.lastT = null;
  }

  filter(metrics: Metrics, t: number, smoothingMs: number): Metrics {
    if (!metrics.valid || smoothingMs <= 0) {
      this.reset();
      return metrics;
    }
    if (!this.previous || this.previous.cameraPosition !== metrics.cameraPosition || this.lastT == null || t < this.lastT || t - this.lastT > 1000) {
      this.samples = [metrics, metrics];
      this.previous = { ...metrics };
      this.lastT = t;
      return this.previous;
    }
    this.samples = [...this.samples, metrics].slice(-3);
    const previous = this.previous;
    const alpha = 1 - Math.exp(-(t - this.lastT) / smoothingMs);
    const numberValue = (key: "torsoDx" | "torsoDy" | "torsoScale") => previous[key] + alpha * (median(this.samples.map((sample) => sample[key])) - previous[key]);
    const angleValue = (key: "headTiltDeg" | "shoulderTiltDeg") => {
      const change = median(this.samples.map((sample) => lineAngleDifference(sample[key], previous[key])));
      return lineAngleDifference(previous[key] + alpha * change, 0);
    };
    this.previous = {
      ...metrics,
      headTiltDeg: angleValue("headTiltDeg"),
      shoulderTiltDeg: angleValue("shoulderTiltDeg"),
      torsoDx: numberValue("torsoDx"),
      torsoDy: numberValue("torsoDy"),
      torsoScale: numberValue("torsoScale"),
    };
    this.lastT = t;
    return this.previous;
  }
}
