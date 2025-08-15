import type { IRenderer, RendererInfo } from "./IRenderer";
import type { PageState, Point, Stroke } from "../core/models";
import type { Settings } from "../app/PdfInkApp";
import { sizeFor } from "../core/StrokeEngine";

export class Canvas2DRenderer implements IRenderer {
  getInfo(): RendererInfo {
    return { backend: "Canvas2D" };
  }

  drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, W: number, H: number, settings: Settings) {
    const sx = s.refW ? (W / s.refW) : 1;
    const sy = s.refH ? (H / s.refH) : 1;
    const scale = (sx + sy) * 0.5;
    const alpha = s.opacity ?? 1;

    if (s.tool === "eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      this.forEachSegment(s, (p0, p1, width) => {
        ctx.beginPath(); ctx.moveTo(p0.x * W, p0.y * H); ctx.lineTo(p1.x * W, p1.y * H);
        ctx.lineWidth = Math.max(width, s.size * 1.2) * scale; ctx.stroke();
      }, settings);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = s.color;

    this.forEachSegment(s, (p0, p1, width) => {
      ctx.lineWidth = Math.max(0.75, width) * scale;
      ctx.beginPath(); ctx.moveTo(p0.x * W, p0.y * H); ctx.lineTo(p1.x * W, p1.y * H); ctx.stroke();
    }, settings);

    ctx.restore();
  }

  redrawPage(ctx: CanvasRenderingContext2D, page: PageState, W: number, H: number, settings: Settings) {
    ctx.clearRect(0, 0, W, H);
    for (const s of page.strokes) this.drawStroke(ctx, s, W, H, settings);
  }

  private forEachSegment(s: Stroke, draw: (p0: Point, p1: Point, width: number) => void, settings: Settings) {
    const pts = s.points; if (pts.length < 2) return;
    for (let i=1;i<pts.length;i++) {
      const p0 = pts[i-1], p1 = pts[i];
      const dt = Math.max(1, p1.t - p0.t);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const speed = dist / (dt / 1000);
      const press = (p0.p + p1.p) * 0.5;
      const width = sizeFor(press, speed, s.size, settings.velocityAffectsSize, s.device);
      draw(p0, p1, width);
    }
  }
}
