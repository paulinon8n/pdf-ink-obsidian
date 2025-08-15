import { PDFDocument } from "pdf-lib";
import type { PageState, Stroke } from "../core/models";
import { sizeFor } from "../core/StrokeEngine";

export class FlattenExporter {
  async flattenAll(pdfBytes: ArrayBuffer, pages: Record<number, PageState>) {
    const pdfDoc = await PDFDocument.load(pdfBytes);

    for (const [pageIndexStr, pageData] of Object.entries(pages)) {
      const pageIndex = Number(pageIndexStr);
      if (!pageData?.strokes?.length) continue;

      const page = pdfDoc.getPage(pageIndex);
      const { width: W, height: H } = page.getSize();

      const scale = 2;
      const cvs = document.createElement("canvas");
      cvs.width = Math.max(1, Math.round(W * scale));
      cvs.height = Math.max(1, Math.round(H * scale));
      const ctx = cvs.getContext("2d")!;
      for (const s of pageData.strokes) this.drawStrokeOn(ctx, s, cvs.width, cvs.height, 1, true);

      const pngBytes = await this.canvasToPNGBytes(cvs);
      const png = await pdfDoc.embedPng(pngBytes);
      page.drawImage(png, { x: 0, y: 0, width: W, height: H });
    }
    return await pdfDoc.save({ useObjectStreams: false });
  }

  private async canvasToPNGBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>(res => {
      if ((canvas as any).toBlob) (canvas as any).toBlob((b: Blob | null) => res(b), "image/png");
      else res(null);
    });
    if (blob) { const ab = await blob.arrayBuffer(); return new Uint8Array(ab); }
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1] || "";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  private drawStrokeOn(ctx: CanvasRenderingContext2D, s: Stroke, W: number, H: number, scale: number, velAffects: boolean) {
    const sx = s.refW ? (W / s.refW) : 1;
    const sy = s.refH ? (H / s.refH) : 1;
    const invScale = (sx + sy) * 0.5;
    const alpha = s.opacity ?? 1;

    if (s.tool === "eraser") {
      ctx.save(); ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let i=1;i<s.points.length;i++){
        const p0 = s.points[i-1], p1 = s.points[i];
        const dt = Math.max(1, p1.t - p0.t);
        const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const speed = dist / (dt/1000);
        const press = (p0.p + p1.p) * 0.5;
        const w = Math.max(sizeFor(press, speed, s.size, velAffects, s.device), s.size * 1.2) * scale * invScale;
        ctx.beginPath(); ctx.moveTo(p0.x * W, p0.y * H); ctx.lineTo(p1.x * W, p1.y * H);
        ctx.lineWidth = w; ctx.stroke();
      }
      ctx.restore(); return;
    }

    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = alpha;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = s.color;
    for (let i=1;i<s.points.length;i++){
      const p0 = s.points[i-1], p1 = s.points[i];
      const dt = Math.max(1, p1.t - p0.t);
      const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const speed = dist / (dt/1000);
      const press = (p0.p + p1.p) * 0.5;
      const w = Math.max(0.75, sizeFor(press, speed, s.size, velAffects, s.device)) * scale * invScale;
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p0.x * W, p0.y * H); ctx.lineTo(p1.x * W, p1.y * H); ctx.stroke();
    }
    ctx.restore();
  }
}
