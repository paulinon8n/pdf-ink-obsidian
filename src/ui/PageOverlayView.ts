import type { Settings } from "../app/PdfInkApp";
import type { PageState, Stroke } from "../core/models";
import { tiltMag } from "../core/StrokeEngine";
import { PdfDomAdapter } from "../pdf/PdfDomAdapter";
import { DocumentSession } from "../core/DocumentSession";
import type { Tool, ToolId } from "../core/tools/Tool";
import type { IRenderer } from "../render/IRenderer";
import { isIOS } from "../utils/platform";

type InteractionMode = "draw" | "pan";

type Cfg = {
  pageEl: HTMLElement;
  pageIndex: number;
  pdf: PdfDomAdapter;
  settings: Settings;
  session: DocumentSession;
  onStrokeCommitted: () => void;

  getToolById: (id: ToolId) => Tool;
  renderer: IRenderer;
};

export class PageOverlayView {
  pageEl: HTMLElement;
  pageIndex: number;
  pdf: PdfDomAdapter;
  settings: Settings;
  session: DocumentSession;
  onStrokeCommitted: () => void;

  getToolById: (id: ToolId) => Tool;
  renderer: IRenderer;

  layerEl!: HTMLElement;

  // 2D
  canvas!: HTMLCanvasElement; ctx!: CanvasRenderingContext2D;
  inkCanvas!: HTMLCanvasElement; inkCtx!: CanvasRenderingContext2D;

  // WebGL DOM
  domGLCanvas: HTMLCanvasElement | null = null;
  private glBasePrepared = false;

  wrapperEl: HTMLElement | null = null;
  textLayerEl: HTMLElement | null = null;

  drawing = false;
  current: Stroke | null = null;

  private currentToolId: ToolId = "pen";
  private mode: InteractionMode = "draw";

  private currentDrawnCount = 0;

  raf = 0; layoutRaf = 0;
  roPage: ResizeObserver | null = null;
  roWrapper: ResizeObserver | null = null;
  moPage: MutationObserver | null = null;

  penInContact = false;
  blockTouchHandlersBound = false;
  touchIds = new Set<number>();
  keepOnTopUntil = 0;

  private pageCaptureBound = {
    down: (e: PointerEvent) => this.onPageCaptureDown(e),
    move: (e: PointerEvent) => this.onPageCaptureMove(e),
    up: (e: PointerEvent) => this.onPageCaptureUp(e),
    cancel: (e: PointerEvent) => this.onPageCaptureCancel(e),
  };

  constructor(cfg: Cfg) {
    this.pageEl = cfg.pageEl;
    this.pageIndex = cfg.pageIndex;
    this.pdf = cfg.pdf;
    this.settings = cfg.settings;
    this.session = cfg.session;
    this.onStrokeCommitted = cfg.onStrokeCommitted;
    this.getToolById = cfg.getToolById;
    this.renderer = cfg.renderer;
  }

  attach(pageEl: HTMLElement, index: number) { this.pageEl = pageEl; this.pageIndex = index; }

  setTool(id: ToolId) { this.currentToolId = id; this.updatePointerEvents(); }
  setInteractionMode(mode: InteractionMode) { this.mode = mode; this.updatePointerEvents(); }

  private get2D(ctxCanvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const opts: any = { alpha: true, desynchronized: true };
    return (
      (ctxCanvas.getContext("2d", opts) as CanvasRenderingContext2D | null) ||
      (ctxCanvas.getContext("2d") as CanvasRenderingContext2D)
    )!;
  }

  mount() {
    this.findPdfLayers();

    if (!this.layerEl) {
      this.layerEl = document.createElement("div");
      this.layerEl.className = "pdf-ink-layer";
      Object.assign(this.layerEl.style, {
        position: "absolute", left: "0px", top: "0px", right: "0px", bottom: "0px",
        zIndex: "2147483647", pointerEvents: "none", userSelect: "none", willChange: "transform, opacity",
      } as CSSStyleDeclaration);

      const domGL = (this.renderer as any).getDomCanvas?.() as HTMLCanvasElement | null;
      if (domGL) {
        this.domGLCanvas = domGL;

        this.layerEl.style.pointerEvents = "auto";
        (this.domGLCanvas.style as any).pointerEvents = "auto";

        this.layerEl.appendChild(this.domGLCanvas);
        console.log("[PDF Ink] PageOverlayView: usando GL DOM no page", this.pageIndex);

        const opts = { passive: false, capture: true } as const;
        this.domGLCanvas.addEventListener("pointerdown", this.pointerDown, opts);
        this.domGLCanvas.addEventListener("pointermove", this.pointerMove, opts);
        this.domGLCanvas.addEventListener("pointerup", this.pointerUp, opts);
        this.domGLCanvas.addEventListener("pointercancel", this.pointerCancel, { passive: true, capture: true });
        // opcional: alguns navegadores disparam pointerrawupdate; manter não é fallback
        this.domGLCanvas.addEventListener?.("pointerrawupdate", this.pointerMove as any, opts);

        // captura na página (quando o alvo não for o canvas GL)
        this.pageEl.addEventListener("pointerdown", this.pageCaptureBound.down, opts);
        this.pageEl.addEventListener("pointermove", this.pageCaptureBound.move, opts);
        this.pageEl.addEventListener("pointerup", this.pageCaptureBound.up, opts);
        this.pageEl.addEventListener("pointercancel", this.pageCaptureBound.cancel, { passive: true, capture: true });

      } else {
        // Modo 2D (não usado em webgl forçado; mantido por compatibilidade)
        this.inkCanvas = document.createElement("canvas");
        this.inkCtx = this.get2D(this.inkCanvas);
        (this.inkCanvas.style as any).pointerEvents = "none";

        this.canvas = document.createElement("canvas");
        this.ctx = this.get2D(this.canvas);

        this.layerEl.appendChild(this.inkCanvas);
        this.layerEl.appendChild(this.canvas);

        const opts = { passive: false, capture: true } as const;
        this.canvas.addEventListener("pointerdown", this.pointerDown, opts);
        this.canvas.addEventListener("pointermove", this.pointerMove, opts);
        this.canvas.addEventListener("pointerup", this.pointerUp, opts);
        this.canvas.addEventListener("pointercancel", this.pointerCancel, { passive: true, capture: true });
        this.canvas.addEventListener?.("pointerrawupdate", this.pointerMove as any, opts);

        this.canvas.addEventListener("pointerdown", this.touchRedirector, { passive: true, capture: true });
        this.canvas.addEventListener("pointerup", this.touchRedirectEnd, { passive: true, capture: true });
        this.canvas.addEventListener("pointercancel", this.touchRedirectEnd, { passive: true, capture: true });
      }

      this.pageEl.appendChild(this.layerEl);
    } else {
      this.pageEl.appendChild(this.layerEl);
    }

    this.moPage?.disconnect();
    this.moPage = new MutationObserver(() => {
      const prevWrapper = this.wrapperEl;
      this.findPdfLayers();
      if (prevWrapper !== this.wrapperEl) {
        this.roWrapper?.disconnect();
        if (this.wrapperEl) {
          this.roWrapper = new ResizeObserver(() => { this.syncLayout(true); this.requestTop(); });
          this.roWrapper.observe(this.wrapperEl);
        }
      }
      this.syncLayout(false);
      this.requestTop();
    });
    this.moPage.observe(this.pageEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });

    this.roPage?.disconnect();
    this.roPage = new ResizeObserver(() => { this.syncLayout(false); this.requestTop(); });
    this.roPage.observe(this.pageEl);

    this.roWrapper?.disconnect();
    if (this.wrapperEl) {
      this.roWrapper = new ResizeObserver(() => { this.syncLayout(true); this.requestTop(); });
      this.roWrapper.observe(this.wrapperEl);
    }

    this.updatePointerEvents();
    this.syncLayout(true);
    this.requestTop();

    this.redrawAll();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.layoutRaf);
    this.moPage?.disconnect(); this.moPage = null;
    this.roPage?.disconnect(); this.roPage = null;
    this.roWrapper?.disconnect(); this.roWrapper = null;
    this.disablePalmRejection();

    if (this.pageEl && this.domGLCanvas) {
      this.pageEl.removeEventListener("pointerdown", this.pageCaptureBound.down as any, true);
      this.pageEl.removeEventListener("pointermove", this.pageCaptureBound.move as any, true);
      this.pageEl.removeEventListener("pointerup", this.pageCaptureBound.up as any, true);
      this.pageEl.removeEventListener("pointercancel", this.pageCaptureBound.cancel as any, true);
    }

    this.layerEl?.remove();
  }

  destroy() {
    this.detach();
    const target = this.domGLCanvas || this.canvas;
    if (target) {
      target.removeEventListener("pointerdown", this.pointerDown as any, true);
      target.removeEventListener("pointermove", this.pointerMove as any, true);
      target.removeEventListener("pointerrawupdate", this.pointerMove as any, true);
      target.removeEventListener("pointerup", this.pointerUp as any, true);
      target.removeEventListener("pointercancel", this.pointerCancel as any, true);
      target.removeEventListener("pointerdown", this.touchRedirector as any, true);
      target.removeEventListener("pointerup", this.touchRedirectEnd as any, true);
      target.removeEventListener("pointercancel", this.touchRedirectEnd as any, true);
    }
  }

  requestTop() {
    this.keepOnTopUntil = Math.max(this.keepOnTopUntil, performance.now() + 1500);
    const pump = () => {
      if (!this.layerEl || !this.pageEl) return;
      if (this.layerEl !== this.pageEl.lastElementChild) this.pageEl.appendChild(this.layerEl);
      (this.layerEl.style as any).zIndex = "2147483647";
      if (performance.now() < this.keepOnTopUntil) requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  }

  /* ---------------------- Layout & redraw ---------------------- */
  findPdfLayers() {
    this.wrapperEl = this.pageEl.querySelector<HTMLElement>('.canvasWrapper') || null;
    this.textLayerEl = this.pageEl.querySelector<HTMLElement>('.textLayer') || null;
  }

  private cloneTransformFromSource() {
    const src = this.wrapperEl || this.textLayerEl || this.pageEl;
    const cs = getComputedStyle(src);
    if (this.layerEl) {
      this.layerEl.style.transform = cs.transform;
      this.layerEl.style.transformOrigin = cs.transformOrigin || "0 0";
    }
  }

  syncLayout(force = false) {
    this.cloneTransformFromSource();

    const src = this.wrapperEl || this.textLayerEl || this.pageEl;
    const cssW = (src as HTMLElement).clientWidth || (src as HTMLElement).offsetWidth || 1;
    const cssH = (src as HTMLElement).clientHeight || (src as HTMLElement).offsetHeight || 1;

    const dpr = Math.max(1, Math.round((isIOS ? 1 : Math.min(2, window.devicePixelRatio || 1)) * 100) / 100);

    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));

    const left = (src as HTMLElement).offsetLeft || 0;
    const top  = (src as HTMLElement).offsetTop || 0;

    const needResize =
      force ||
      (!this.domGLCanvas && (!this.canvas || this.canvas.width !== pxW || this.canvas.height !== pxH)) ||
      ( this.domGLCanvas && (this.domGLCanvas.width !== pxW || this.domGLCanvas.height !== pxH) );

    cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = requestAnimationFrame(() => {
      if (this.domGLCanvas) {
        (this.renderer as any).resize?.(pxW, pxH);
        Object.assign(this.domGLCanvas.style, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${cssW}px`, height: `${cssH}px`, willChange: "contents" } as CSSStyleDeclaration);
        if (needResize) { this.glBasePrepared = false; this.redrawAll(); } else { this.flushFrame(); }
        return;
      }

      if (!this.canvas || !this.inkCanvas) return;
      if (needResize) {
        this.canvas.width = pxW; this.canvas.height = pxH;
        this.inkCanvas.width = pxW; this.inkCanvas.height = pxH;
      }
      const style = { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${cssW}px`, height: `${cssH}px` } as CSSStyleDeclaration;
      Object.assign(this.inkCanvas.style, style);
      Object.assign(this.canvas.style, style);
      if (needResize) this.redrawAll(); else this.flushFrame();
    });
  }

  redrawAll() {
    const pd: PageState = this.session.page(this.pageIndex);

    if (this.domGLCanvas) {
      const W = this.domGLCanvas.width, H = this.domGLCanvas.height;
      this.renderer.redrawPage(undefined as any, pd, W, H, this.settings);
      this.glBasePrepared = true;
      this.renderer.present?.();
      this.flushFrame();
      return;
    }

    if (!this.inkCtx || !this.inkCanvas) return;
    this.renderer.redrawPage(this.inkCtx, pd, this.inkCanvas.width, this.inkCanvas.height, this.settings);
    this.flushFrame();
  }

  visibleArea(): number {
    const r = this.pageEl.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const y = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return x * y;
  }

  /* --------------------- Pointer & palm-rejection --------------------- */

  private drawingEnabled(): boolean { return this.mode === "draw"; }

  private applyTouchAction(drawingOn: boolean) {
    const val = drawingOn ? "none" : "pan-x pan-y pinch-zoom";
    if (this.domGLCanvas) (this.domGLCanvas.style as any).touchAction = val;
    if (this.canvas)      (this.canvas.style as any).touchAction = val;
    (this.layerEl.style as any).touchAction = val;
    this.layerEl.classList.toggle("is-drawing", drawingOn);
  }

  updatePointerEvents() {
    if (!this.layerEl) return;
    const on = this.drawingEnabled();

    if (this.domGLCanvas) {
      this.layerEl.style.pointerEvents = on ? "auto" : "none";
      this.domGLCanvas.style.pointerEvents = on ? "auto" : "none";
    } else if (this.canvas) {
      this.canvas.style.pointerEvents = on ? "auto" : "none";
    }

    this.applyTouchAction(on);

    console.log("[PDF Ink] updatePointerEvents:", {
      page: this.pageIndex,
      mode: this.mode,
      hasGL: !!this.domGLCanvas,
      targetPE: (this.domGLCanvas || this.canvas)?.style.pointerEvents,
      layerPE: this.layerEl.style.pointerEvents,
    });
  }

  private blockTouch = (ev: TouchEvent) => { if (this.penInContact) { ev.preventDefault(); ev.stopPropagation(); } };
  private enablePalmRejection() {
    if (this.blockTouchHandlersBound) return;
    window.addEventListener("touchstart", this.blockTouch, { passive: false, capture: true });
    window.addEventListener("touchmove",  this.blockTouch, { passive: false, capture: true });
    window.addEventListener("touchend",   this.blockTouch, { passive: false, capture: true });
    window.addEventListener("touchcancel",this.blockTouch, { passive: false, capture: true });
    this.blockTouchHandlersBound = true;
  }
  private disablePalmRejection() {
    if (!this.blockTouchHandlersBound) return;
    window.removeEventListener("touchstart", this.blockTouch, true as any);
    window.removeEventListener("touchmove",  this.blockTouch, true as any);
    window.removeEventListener("touchend",   this.blockTouch, true as any);
    window.removeEventListener("touchcancel",this.blockTouch, true as any);
    this.blockTouchHandlersBound = false;
  }

  private touchRedirector = (e: PointerEvent) => {
    if (this.domGLCanvas) return;
    if (e.pointerType !== "touch") return;
    if (this.penInContact) return;
    if (this.drawingEnabled() && this.canvas) {
      this.touchIds.add(e.pointerId);
      this.canvas.style.pointerEvents = "none";
      queueMicrotask(() => {});
    }
  };
  private touchRedirectEnd = (e: PointerEvent) => {
    if (this.domGLCanvas) return;
    if (e.pointerType !== "touch") return;
    if (!this.touchIds.has(e.pointerId)) return;
    this.touchIds.delete(e.pointerId);
    if (this.touchIds.size === 0 && this.drawingEnabled() && this.canvas) {
      this.canvas.style.pointerEvents = "auto";
    }
  };

  private onPageCaptureDown(e: PointerEvent) {
    if (!this.domGLCanvas) return;
    if ((e.target as any) === this.domGLCanvas) return;
    if (!this.drawingEnabled()) return;
    if (this.settings.onlyPenDraws && e.pointerType === "touch") return;
    if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;

    e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();
    this.pointerDown(e);
  }
  private onPageCaptureMove(e: PointerEvent) {
    if (!this.domGLCanvas) return;
    if (!this.drawing) return;
    e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();
    this.pointerMove(e);
  }
  private onPageCaptureUp(e: PointerEvent) {
    if (!this.domGLCanvas) return;
    if (!this.drawing) return;
    e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();
    this.pointerUp(e);
  }
  private onPageCaptureCancel(e: PointerEvent) {
    if (!this.domGLCanvas) return;
    this.pointerCancel(e);
  }

  pointerDown = (e: PointerEvent) => {
    const target = (this.domGLCanvas || this.canvas);
    if (!target) return;

    if (!this.drawingEnabled()) return;
    if (this.settings.onlyPenDraws && e.pointerType === "touch") return;
    if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;

    e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();

    if (e.pointerType === "pen") { this.penInContact = true; this.enablePalmRejection(); }

    (target as any).setPointerCapture?.(e.pointerId);

    const { nx, ny } = this.norm(target, e.clientX, e.clientY);
    const device = (e.pointerType === "pen") ? "pen" : "mouse";
    const tool = this.getToolById(this.currentToolId);

    this.current = tool.createStroke({
      device, refW: target.width, refH: target.height, settings: this.settings,
      point: { x: nx, y: ny, p: e.pressure ?? 0.5, t: performance.now(), tilt: tiltMag(e), twist: (e as any).twist ?? 0 }
    });

    this.currentDrawnCount = 1;
    this.drawing = true;

    if (this.domGLCanvas) {
      // base (strokes já comprometidos) uma vez por traço
      const W = this.domGLCanvas.width, H = this.domGLCanvas.height;
      const base: PageState = this.session.page(this.pageIndex);
      this.renderer.redrawPage(undefined as any, base, W, H, this.settings);
      this.glBasePrepared = true;
      this.renderer.present?.();
    }

    this.flushFrame();
  };

  pointerMove = (e: PointerEvent) => {
    if (!this.drawing || !this.current) return;
    if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;

    const batch = (e.getCoalescedEvents?.() || [e]) as PointerEvent[];
    e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();

    const target = (this.domGLCanvas || this.canvas)!;
    const nowBase = performance.now();
    for (let i=0;i<batch.length;i++) {
      const ev = batch[i];
      const { nx, ny } = this.norm(target, ev.clientX, ev.clientY);
      const t = nowBase + i * 0.05;
      this.current.points.push({
        x: nx, y: ny,
        p: ev.pressure ?? 0.5,
        t,
        tilt: tiltMag(ev),
        twist: (ev as any).twist ?? 0
      });
    }

    this.flushFrame();
  };

  pointerUp = (e: PointerEvent) => {
    if (!this.drawing || !this.current) return;
    e.preventDefault(); e.stopPropagation(); (e as any).stopImmediatePropagation?.();

    if (e.pointerType === "pen") { this.penInContact = false; setTimeout(() => this.disablePalmRejection(), 20); }

    this.drawing = false;

    if (this.domGLCanvas) {
      this.session.addStroke(this.pageIndex, this.current);
      this.current = null;
      this.currentDrawnCount = 0;
      this.glBasePrepared = false;
      this.redrawAll();
      this.renderer.present?.();
    } else {
      if (this.inkCtx && this.inkCanvas) {
        this.renderer.drawStroke(this.inkCtx, this.current, this.inkCanvas.width, this.inkCanvas.height, this.settings);
      }
      this.session.addStroke(this.pageIndex, this.current);
      this.current = null;
      this.currentDrawnCount = 0;
      this.flushFrame();
    }

    this.onStrokeCommitted();
  };

  pointerCancel = (_e: PointerEvent) => {
    if (this.penInContact) setTimeout(() => this.disablePalmRejection(), 20);
    this.penInContact = false;
    this.drawing = false;
    this.current = null;
    this.currentDrawnCount = 0;
    this.flushFrame();
  };

  requestUndo() {
    if (this.drawing) { this.drawing = false; this.current = null; this.flushFrame(); }
    this.session.undo(this.pageIndex);
    this.glBasePrepared = false;
    this.redrawAll();
  }
  requestRedo() {
    this.session.redo(this.pageIndex);
    this.glBasePrepared = false;
    this.redrawAll();
  }

  private tick() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.flushFrame(); });
  }

  private flushFrame() {
    if (this.domGLCanvas) {
      const W = this.domGLCanvas.width, H = this.domGLCanvas.height;

      if (this.drawing && this.current) {
        if (!this.glBasePrepared) {
          const base: PageState = this.session.page(this.pageIndex);
          this.renderer.redrawPage(undefined as any, base, W, H, this.settings);
          this.glBasePrepared = true;
        }

        const from = Math.max(1, this.currentDrawnCount - 1);

        // **binding correto** — chama método no objeto (mantém `this` do renderer)
        if (this.renderer.drawStrokeTail) {
          this.renderer.drawStrokeTail(this.current, W, H, this.settings, from);
        } else {
          this.renderer.drawStroke(undefined as any, this.current, W, H, this.settings);
        }

        this.currentDrawnCount = this.current.points.length;
        this.renderer.present?.(); // apresentação imediata
      }
      return;
    }

    if (!this.canvas || !this.ctx) return;
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    if (this.current) this.renderer.drawStroke(this.ctx, this.current, width, height, this.settings);
  }

  private norm(target: HTMLCanvasElement, eX: number, eY: number): { nx: number; ny: number } {
    const r = target.getBoundingClientRect();
    return { nx: (eX - r.left) / r.width, ny: (eY - r.top) / r.height };
  }
}
