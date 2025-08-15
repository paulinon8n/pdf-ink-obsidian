import { App, Notice, TFile } from "obsidian";
import { PdfDomAdapter } from "../pdf/PdfDomAdapter";
import { DocumentSession } from "../core/DocumentSession";
import { ISidecarStore } from "../storage/SidecarStore";
import { FlattenExporter } from "../export/FlattenExporter";
import { ToolbarView } from "../ui/ToolbarView";
import { PageOverlayView } from "../ui/PageOverlayView";
import type { ToolId } from "../core/tools/Tool";
import { ToolRegistry } from "../core/tools/ToolRegistry";
import { PenTool } from "../core/tools/PenTool";
import { EraserTool } from "../core/tools/EraserTool";
import { Canvas2DRenderer } from "../render/Canvas2DRenderer";
import type { IRenderer } from "../render/IRenderer";
import { WebGLRenderer } from "../render/WebGLRenderer";
import { Settings } from "./PdfInkApp";
import { TwoFingerDoubleTapRecognizer } from "./gestures/TwoFingerDoubleTap";
import { isIOS } from "../utils/platform";

type InteractionMode = "draw" | "pan";

type Cfg = {
  app: App;
  settings: Settings;
  file: TFile;
  pdf: PdfDomAdapter;
  session: DocumentSession;
  store: ISidecarStore;
  exporter: FlattenExporter;
  onRequestSaveSettings: () => Promise<void>;
};

export class InkController {
  private cfg: Cfg;

  private toolbar!: ToolbarView;
  private overlays = new Map<number, PageOverlayView>();
  private freePool: PageOverlayView[] = [];
  private viewportPages = new Set<number>();
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private mo: MutationObserver | null = null;
  private moToolbar: MutationObserver | null = null;

  private autosaveTimer: number | null = null;
  private static readonly AUTOSAVE_DELAY = 800;

  private tools = new ToolRegistry();
  private activeTool: ToolId = "pen";
  private mode: InteractionMode = "draw";

  private sharedRenderer: IRenderer | null = null;
  private makeRendererForOverlay: (() => IRenderer) | null = null;
  private rendererFlavor: "canvas2d" | "webgl-composite2d" | "webgl-dom" = "canvas2d";

  private twoTap?: TwoFingerDoubleTapRecognizer;

  private isMigratedToNative = false;
  private migratingNow = false;
  private lastMigCheck = 0;

  // info p/ status chip
  private rendererInfoText = "–";
  private rendererOK = false;

  constructor(cfg: Cfg) { this.cfg = cfg; }

  async mount() {
    console.log("[PDF Ink] mount: iniciando controller");
    const { pdf } = this.cfg;

    this.tools.register(new PenTool());
    this.tools.register(new EraserTool());
    this.tools.setActive("pen");

    try {
      this.setupRenderersWithLogs(this.cfg.settings.rendererMode);
    } catch (e) {
      console.error("[PDF Ink] Falha ao inicializar renderer no modo exigido:", e);
      new Notice("PDF Ink: WebGL é obrigatório (modo WebGL). Não foi possível inicializar. Troque para 'Auto' ou 'Canvas 2D'.");
      return;
    }

    const rightHost = pdf.findToolbarRight() || pdf.ensureToolbarRight();
    this.toolbar = new ToolbarView(rightHost, {
      color: this.cfg.settings.penColor,
      size: this.cfg.settings.penSize,
      opacity: Math.round(this.cfg.settings.penOpacity * 100),
    });

    this.toolbar.on("selectTool", (id: ToolId | "pan") => {
      if (id === "pan") { this.setInteractionMode("pan"); return; }
      if (id === this.activeTool) {
        this.setInteractionMode(this.mode === "draw" ? "pan" : "draw");
      } else {
        this.activeTool = id; this.tools.setActive(id); this.setInteractionMode("draw");
      }
    });
    this.toolbar.on("colorChange", async (hex) => { this.cfg.settings.penColor = hex; await this.cfg.onRequestSaveSettings(); });
    this.toolbar.on("sizeChange", async (px) => { this.cfg.settings.penSize = px; await this.cfg.onRequestSaveSettings(); });
    this.toolbar.on("opacityChange", async (v) => { this.cfg.settings.penOpacity = Math.max(0.1, Math.min(1, v / 100)); await this.cfg.onRequestSaveSettings(); });
    this.toolbar.on("undo", () => { this.activeOverlay()?.requestUndo(); this.scheduleAutosave(); });
    this.toolbar.on("redo", () => { this.activeOverlay()?.requestRedo(); this.scheduleAutosave(); });
    this.toolbar.on("saveSidecar", () => this.saveSidecar("manual").catch(err => new Notice(String(err))));
    this.toolbar.on("exportFlatten", () => this.exportFlattenCopy().catch(err => new Notice(String(err))));

    this.toolbar.mount();
    this.toolbar.setActiveTool("pen");
    this.updateStatusChip(); // mostra status inicial

    await this.loadSidecar();

    this.mo = new MutationObserver(() => this.syncPages());
    this.mo.observe(pdf.viewer, { childList: true, subtree: true, attributes: true });

    this.ro = new ResizeObserver(() => {
      this.syncPages();
      for (const [, ov] of this.overlays) ov.requestTop();
    });
    this.ro.observe(pdf.viewer);

    this.setupIntersection();
    this.syncPages();

    this.propagateToolAndMode();

    this.installTwoFingerDoubleTap();

    this.moToolbar = new MutationObserver(() => this.maybeMigrateToolbarToNative());
    this.moToolbar.observe(this.cfg.pdf.container, { childList: true, subtree: true });
    this.maybeMigrateToolbarToNative();
  }

  private setupRenderersWithLogs(mode: Settings["rendererMode"]) {
    const t0 = performance.now();
    const log = (chosen: string, reason: string) =>
      console.log(`[PDF Ink] Renderer: ${chosen} (modo=${mode}). ${reason}. +${(performance.now()-t0).toFixed(1)}ms`);

    const setShared = (renderer: IRenderer, flavor: typeof this.rendererFlavor) => {
      this.sharedRenderer = renderer;
      this.makeRendererForOverlay = () => this.sharedRenderer!;
      this.rendererFlavor = flavor;
      this.captureRendererInfo(renderer);
    };
    const setFactory = (factory: () => IRenderer, flavor: typeof this.rendererFlavor, probe?: IRenderer) => {
      this.sharedRenderer = null;
      this.makeRendererForOverlay = factory;
      this.rendererFlavor = flavor;
      if (probe) this.captureRendererInfo(probe);
    };

    if (mode === "canvas2d") {
      const r = new Canvas2DRenderer();
      setShared(r, "canvas2d");
      log("Canvas 2D (shared)", "forçado");
      return;
    }

    if (mode === "webgl") {
      // Sem fallback: exige WebGL DOM
      const probe = new WebGLRenderer("dom");
      (probe as any).getDomCanvas?.();
      setFactory(() => new WebGLRenderer("dom"), "webgl-dom", probe);
      log("WebGL (DOM per-overlay)", "forçado SEM fallback");
      return;
    }

    // auto
    if (isIOS) {
      const r = new Canvas2DRenderer();
      setShared(r, "canvas2d");
      log("Canvas 2D (shared)", "auto: iOS prioriza 2D");
      return;
    }
    try {
      const r = new WebGLRenderer("composite2D");
      setShared(r, "webgl-composite2d");
      log("WebGL (composite2D, shared)", "auto: disponível");
    } catch (e) {
      const r = new Canvas2DRenderer();
      setShared(r, "canvas2d");
      log("Canvas 2D (shared)", "auto: WebGL indisponível");
    }
  }

  private captureRendererInfo(renderer: IRenderer) {
    const info = renderer.getInfo?.();
    if (!info) { this.rendererInfoText = "–"; this.rendererOK = false; return; }
    if (info.backend === "WebGL") {
      const bits = [
        "WebGL ✔",
        info.renderer || info.vendor || "",
        info.mode ? `(${info.mode})` : "",
        info.antialias === false ? "no-AA" : ""
      ].filter(Boolean);
      this.rendererInfoText = bits.join(" — ");
      this.rendererOK = true;
    } else {
      this.rendererInfoText = "WebGL ✖ — Canvas 2D";
      this.rendererOK = false;
    }
  }

  private updateStatusChip() {
    this.toolbar?.setStatus(this.rendererInfoText, this.rendererOK);
  }

  destroy() {
    void this.saveSidecar("auto").catch(() => {});
    this.clearAutosave();
    this.io?.disconnect(); this.io = null;
    this.ro?.disconnect(); this.ro = null;
    this.mo?.disconnect(); this.mo = null;
    this.moToolbar?.disconnect(); this.moToolbar = null;
    this.twoTap?.detach(); this.twoTap = undefined;
    for (const [, ov] of this.overlays) ov.destroy();
    this.overlays.clear();
    this.freePool.length = 0;
    this.toolbar?.destroy();
  }

  private maybeMigrateToolbarToNative() {
    if (!this.toolbar || this.isMigratedToNative || this.migratingNow) return;
    const now = performance.now();
    if (now - this.lastMigCheck < 100) return;
    this.lastMigCheck = now;

    this.migratingNow = true;
    try {
      const nativeRight = this.cfg.pdf.findToolbarRight();
      if (!nativeRight) return;
      const currentHost = (this.toolbar as any).getHost?.() || null;
      if (currentHost && (this.toolbar as any).moveToHost && currentHost !== nativeRight) {
        (this.toolbar as any).moveToHost(nativeRight);
        this.isMigratedToNative = true;
        this.moToolbar?.disconnect(); this.moToolbar = null;
        console.log("[PDF Ink] Toolbar migrada para barra nativa.");
      }
    } finally {
      this.migratingNow = false;
    }
  }

  private installTwoFingerDoubleTap() {
    this.twoTap = new TwoFingerDoubleTapRecognizer(window, {
      onDoubleTap: () => {
        const ov = this.activeOverlay();
        if (ov) { ov.requestUndo(); this.scheduleAutosave(); }
      },
      maxSingleTapDurationMs: 250,
      maxInterTapDelayMs: 300,
      maxMovePx: 18,
    });
    this.twoTap.attach();
  }

  private setInteractionMode(mode: InteractionMode) {
    this.mode = mode;
    this.toolbar.setActiveTool(mode === "pan" ? "pan" : this.activeTool);
    this.propagateToolAndMode();
  }
  private propagateToolAndMode() {
    for (const [, ov] of this.overlays) {
      ov.setTool(this.tools.activeId());
      ov.setInteractionMode(this.mode);
    }
  }

  private async loadSidecar() {
    const data = await this.cfg.store.load(this.cfg.file.path);
    if (data) this.cfg.session.fromJSON(data);
  }
  private clearAutosave() { if (this.autosaveTimer) { window.clearTimeout(this.autosaveTimer); this.autosaveTimer = null; } }
  scheduleAutosave() {
    this.clearAutosave();
    this.autosaveTimer = window.setTimeout(() => this.saveSidecar("auto").catch(console.error), InkController.AUTOSAVE_DELAY);
  }
  async saveSidecar(kind: "auto" | "manual") {
    const json = this.cfg.session.toJSON();
    if (!json || !Object.values(json.pages || {}).some((p: any) => p?.strokes?.length)) {
      if (kind === "manual") new Notice("Nada para salvar (JSON).");
      return;
    }
    await this.cfg.store.save(this.cfg.file.path, json);
    if (kind === "manual") new Notice("Anotações salvas (JSON sidecar).");
  }

  async exportFlattenCopy() {
    const bytes = await this.cfg.app.vault.adapter.readBinary(this.cfg.file.path);
    const baked = await this.cfg.exporter.flattenAll(bytes, this.cfg.session.getPages());
    const outPath = this.cfg.file.path.replace(/\.pdf$/i, " (flat).pdf");
    await this.cfg.app.vault.adapter.writeBinary(outPath, baked);
    new Notice("Cópia flatten criada: " + outPath);
  }

  private setupIntersection() {
    const root = this.cfg.pdf.scrollRoot();
    this.io = new IntersectionObserver((entries) => {
      const seen = new Set<number>();
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const idx = this.cfg.pdf.indexForPage(el);
        if (idx == null) continue;
        if (e.isIntersecting) seen.add(idx);
      }
      const all = this.cfg.pdf.allPages();
      if (seen.size) {
        const idxs = [...seen].sort((a,b)=>a-b);
        const min = Math.max(0, idxs[0] - 2);
        const max = Math.min(all.length - 1, idxs[idxs.length - 1] + 2);
        this.viewportPages = new Set<number>();
        for (let i=min;i<=max;i++) this.viewportPages.add(i);
      }
      this.reconcileOverlays();
    }, { root: root as any, threshold: 0.03, rootMargin: '20% 0px' });
  }

  private syncPages() {
    const pages = this.cfg.pdf.allPages();
    pages.forEach(p => this.io?.observe(p));
    this.reconcileOverlays();
    for (const [, ov] of this.overlays) ov.requestTop();
  }

  private reconcileOverlays() {
    const activeIdx = this.activePageIndex();
    const want = [...this.viewportPages].sort((a,b)=>Math.abs(a-activeIdx)-Math.abs(b-activeIdx));
    for (const i of want) {
      if (this.overlays.has(i)) continue;
      const pageEl = this.cfg.pdf.pageAt(i);
      if (!pageEl) continue;

      const renderer = this.makeRendererForOverlay ? this.makeRendererForOverlay() : (this.sharedRenderer as IRenderer);

      const ov = this.freePool.pop() || new PageOverlayView({
        pageEl, pageIndex: i,
        pdf: this.cfg.pdf,
        settings: this.cfg.settings,
        session: this.cfg.session,
        onStrokeCommitted: () => this.scheduleAutosave(),
        getToolById: (id) => this.tools.get(id)!,
        renderer,
      });
      ov.attach(pageEl, i);
      ov.setTool(this.tools.activeId());
      ov.setInteractionMode(this.mode);
      this.overlays.set(i, ov);
      ov.mount();
      ov.syncLayout(true);
      ov.redrawAll();

      if (this.overlays.size > 18) break;
    }

    for (const [i, ov] of [...this.overlays]) {
      if (!this.viewportPages.has(i) && this.overlays.size > 18) {
        ov.detach();
        this.overlays.delete(i);
        this.freePool.push(ov);
      }
    }
  }

  private activeOverlay(): PageOverlayView | undefined {
    let max = 0, idx = 0;
    for (const [i, ov] of this.overlays) {
      const vis = ov.visibleArea();
      if (vis > max) { max = vis; idx = i; }
    }
    return this.overlays.get(idx);
  }
  private activePageIndex(): number { return this.activeOverlay()?.pageIndex ?? 0; }
}
