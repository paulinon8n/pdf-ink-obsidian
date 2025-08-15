import { setIcon } from "obsidian";
import { ToolId } from "../core/tools/Tool";

type InitVals = { color: string; size: number; opacity: number };
type Events = {
  selectTool: ToolId | "pan";
  colorChange: string;
  sizeChange: number;
  opacityChange: number;
  undo: void;
  redo: void;
  saveSidecar: void;
  exportFlatten: void;
};

type Listener = (v: any) => void;

export class ToolbarView {
  private host: HTMLElement;
  private init: InitVals;
  private el!: HTMLElement;

  private listeners: Record<string, Listener[]> = Object.create(null);

  private btnPen!: HTMLButtonElement;
  private btnEraser!: HTMLButtonElement;
  private btnPan!: HTMLButtonElement;

  private statusEl!: HTMLSpanElement;

  private onKey = (ev: KeyboardEvent) => {
    const k = ev.key?.toLowerCase();
    if (k === "p") this.emit("selectTool", "pen");
    if (k === "e") this.emit("selectTool", "eraser");
    if ((ev.ctrlKey || ev.metaKey) && k === "z") {
      ev.preventDefault();
      ev.shiftKey ? this.emit("redo", undefined as any) : this.emit("undo", undefined as any);
    }
  };

  constructor(host: HTMLElement, init: InitVals) { this.host = host; this.init = init; }

  on<K extends keyof Events>(ev: K, cb: (v: Events[K]) => void) {
    const key = ev as string;
    (this.listeners[key] ||= []).push(cb as Listener);
  }
  private emit<K extends keyof Events>(ev: K, v: Events[K]) {
    const arr = this.listeners[ev as string];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) arr[i](v);
  }

  mount() {
    this.el = document.createElement("div");
    this.el.className = "pdf-ink-toolbar-inline";

    const makeBtn = (icon: string, title: string, data: Record<string,string> = {}) => {
      const b = document.createElement("button");
      b.className = "clickable-icon";
      b.setAttribute("aria-label", title);
      Object.entries(data).forEach(([k,v]) => b.dataset[k] = v);
      setIcon(b, icon);
      return b;
    };

    this.btnPen = makeBtn("pen-line", "Caneta (P)", { tool: "pen" });
    this.btnEraser = makeBtn("eraser", "Borracha (E)", { tool: "eraser" });
    this.btnPan = makeBtn("hand", "Pan (mover/zoom)", { tool: "pan" });

    const color = document.createElement("input");
    color.type = "color"; color.value = this.init.color; color.title = "Cor";

    const size = document.createElement("input");
    size.type = "range"; size.min = "1"; size.max = "20"; size.value = String(this.init.size); size.title = "Espessura";

    const opacity = document.createElement("input");
    opacity.type = "range"; opacity.min = "10"; opacity.max = "100"; opacity.step = "5";
    opacity.value = String(this.init.opacity); opacity.title = "Opacidade";

    const btnUndo = makeBtn("rotate-ccw", "Undo", { action: "undo" });
    const btnRedo = makeBtn("rotate-cw", "Redo", { action: "redo" });
    const btnSave = makeBtn("save", "Salvar (JSON)", { action: "save-sidecar" });
    const btnFlat = makeBtn("image-down", "Exportar cópia (flatten)", { action: "export-flat" });

    // Status chip (WebGL/Canvas)
    this.statusEl = document.createElement("span");
    this.statusEl.className = "pdf-ink-status";
    this.statusEl.textContent = "–";
    this.statusEl.title = "Status do renderizador";

    const sep = () => { const s = document.createElement("span"); s.className = "sep"; s.style.cssText="width:1px;height:18px;background:var(--background-modifier-border)"; return s; };

    this.el.append(this.btnPen, this.btnEraser, this.btnPan, color, size, opacity, btnUndo, btnRedo, sep(), btnSave, btnFlat, sep(), this.statusEl);
    this.host.appendChild(this.el);

    this.el.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool],button[data-action]');
      if (!btn) return;
      const tool = btn.dataset.tool as (ToolId | "pan") | undefined;
      const action = btn.dataset.action;
      if (tool) return this.emit("selectTool", tool);
      if (action === "undo") return this.emit("undo", undefined as any);
      if (action === "redo") return this.emit("redo", undefined as any);
      if (action === "save-sidecar") return this.emit("saveSidecar", undefined as any);
      if (action === "export-flat") return this.emit("exportFlatten", undefined as any);
    });

    color.addEventListener("input", e => this.emit("colorChange", (e.target as HTMLInputElement).value));
    size.addEventListener("input", e => this.emit("sizeChange", parseInt((e.target as HTMLInputElement).value, 10)));
    opacity.addEventListener("input", e => this.emit("opacityChange", parseInt((e.target as HTMLInputElement).value, 10)));

    window.addEventListener("keydown", this.onKey);
  }

  /** Atualiza o chip de status (ex.: "WebGL ✔ — Apple A14 (DOM)") */
  setStatus(label: string, ok: boolean, tooltip?: string) {
    if (!this.statusEl) return;
    this.statusEl.textContent = label;
    this.statusEl.classList.toggle("ok", !!ok);
    this.statusEl.classList.toggle("bad", !ok);
    if (tooltip) this.statusEl.title = tooltip;
  }

  setActiveTool(id: ToolId | "pan") {
    const set = (el?: HTMLElement, on=false) => el && (on ? el.classList.add("is-active") : el.classList.remove("is-active"));
    set(this.btnPen, id === "pen");
    set(this.btnEraser, id === "eraser");
    set(this.btnPan, id === "pan");
  }

  getHost(): HTMLElement { return this.host; }

  moveToHost(newHost: HTMLElement) {
    if (!newHost || newHost === this.host) return;
    newHost.appendChild(this.el);
    const old = this.host;
    this.host = newHost;
    if (old && old.classList?.contains("pdf-ink-floating") && old.childElementCount === 0) {
      old.remove();
    }
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.el?.remove();
  }
}
