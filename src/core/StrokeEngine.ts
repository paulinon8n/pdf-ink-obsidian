import type { Device } from "./models";

export function sizeFor(pressure: number, speed: number, base: number, velAffects: boolean, device: Device): number {
  const velFactor = 1 / (1 + (velAffects ? speed * 0.6 : 0));
  const p = Math.max(0, Math.min(1, isFinite(pressure) ? pressure : 0.5));
  let width = base * (0.5 + p * 0.8);

  if (device === "pen") {
    const PEN_WIDTH_MULT = 2.0;
    const MIN_FACTOR = 1.0;
    width = Math.max(base * MIN_FACTOR, width * PEN_WIDTH_MULT);
  }

  width *= velFactor;
  return Math.max(0.75, width);
}

export function tiltMag(e: PointerEvent) {
  const tx = (e as any).tiltX, ty = (e as any).tiltY;
  if (typeof tx === "number" && typeof ty === "number") return Math.min(1, Math.hypot(tx, ty) / 90);
  return undefined;
}